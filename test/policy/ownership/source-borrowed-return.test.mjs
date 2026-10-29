import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, Node_Initializer } from "@tsonic/target-api/source";
import { createRustSourceCallableQueries } from "../../../dist/analysis/callables/ownership/borrowed-returns.js";
import { closedUnionCallbackCompletionSource } from "../../../../tsonic/test/fixtures/closed-union-callback-completion.mjs";

function checkedFixture(text, name = "read", valid = true) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project",
    files: { "/project/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  if (valid) assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const sourceFile = checked.getSourceFile("/project/index.ts");
  assert.equal(sourceFile !== undefined, true, "checked source exists");
  const nodes = [];
  const collect = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
  };
  collect(sourceFile);
  const binding = nodes.find(node => source.ast.text(source.ast.name(node)) === name &&
    (source.ast.is.IsVariableDeclaration(node) || source.ast.is.IsFunctionDeclaration(node)));
  const declaration = source.ast.is.IsVariableDeclaration(binding) ? Node_Initializer(source.ast, binding) : binding;
  assert.equal(declaration !== undefined, true, "exact callable declaration");
  return { source, nodes, binding, declaration, parameter: source.ast.parameters(declaration)[0] };
}

function fixture(text, name = "read", valid = true) {
  const current = checkedFixture(text, name, valid);
  const { declaration, binding, source, nodes } = current;
  const queries = createRustSourceCallableQueries(source, nodes, new Set(), () => undefined);
  return { ...current,
    direct: queries.directLexicalBinding(declaration) === binding,
    selected: queries.borrowedReturn(declaration)?.parameter };
}

function observedQueries(current) {
  const { source, nodes } = current;
  const reads = { summaries: 0, selectedCalls: 0, sourceFacts: 0, parents: 0, returnOrigins: 0 };
  const observedSource = Object.freeze({ ...source,
    ast: Object.freeze({ ...source.ast, parent(node) {
      reads.parents++;
      return source.ast.parent(node);
    } }),
    navigation: Object.freeze({ ...source.navigation, declarationUseSummary(node) {
      reads.summaries++;
      return source.navigation.declarationUseSummary(node);
    } }),
    sourceFacts: Object.freeze({ ...source.sourceFacts, getFact(...arguments_) {
      reads.sourceFacts++;
      return source.sourceFacts.getFact(...arguments_);
    } }),
    semantics: Object.freeze({ ...source.semantics, forNode(node) {
      const semantics = source.semantics.forNode(node);
      return { ...semantics, operations: { ...semantics.operations, call(call) {
        reads.selectedCalls++;
        return semantics.operations.call(call);
      } } };
    } }),
  });
  const queries = createRustSourceCallableQueries(observedSource, nodes, new Set(), () => undefined);
  return { queries, reads };
}

function repeatedCalls(count) {
  return `export function run(value: string): boolean {
    const read = (input: string): string => input;
    ${Array.from({ length: count }, () => 'if (read(value) !== value) return false;').join("\n")}
    return true;
  }`;
}

test("source callable queries share immutable lexical and paired-return proofs within one analysis", () => {
  const current = checkedFixture(repeatedCalls(64));
  const { queries, reads } = observedQueries(current);
  assert.equal(Object.isFrozen(queries), true);
  assert.equal(queries.directLexicalBinding(current.declaration) === current.binding, true, "exact lexical binding");
  const lexicalCalls = reads.selectedCalls;
  assert.equal(lexicalCalls, 64, "the independent lexical owner qualifies each checked direct call once");
  assert.equal(queries.borrowedReturn(current.declaration)?.parameter === current.parameter, true, "exact returned input");
  assert.equal(reads.selectedCalls - lexicalCalls, 0, "return selection never queries actual calls");
  assert.equal(reads.returnOrigins, 0, "return selection has no source-storage origin service");
  assert.equal(reads.sourceFacts, 0, "caller mutation facts do not decide the declaration ABI");
  const first = { ...reads };
  for (let iteration = 0; iteration < 128; iteration++) {
    assert.equal(queries.directLexicalBinding(current.declaration) === current.binding, true);
    assert.equal(queries.borrowedReturn(current.declaration)?.parameter === current.parameter, true);
  }
  assert.deepEqual(reads, first, "repeated call-site and ABI consumers do not rescan source evidence");
});

test("source callable proof work grows linearly with distinct direct calls and shared actual inputs", () => {
  const small = checkedFixture(repeatedCalls(32));
  const large = checkedFixture(repeatedCalls(64));
  const first = observedQueries(small);
  const second = observedQueries(large);
  assert.equal(first.queries.borrowedReturn(small.declaration)?.parameter === small.parameter, true);
  assert.equal(second.queries.borrowedReturn(large.declaration)?.parameter === large.parameter, true);
  for (const key of Object.keys(first.reads)) {
    assert.equal(first.reads[key] > 0, key !== "sourceFacts" && key !== "returnOrigins", `${key} has its declared owner`);
    assert.equal(second.reads[key] <= 2 * first.reads[key], true, `${key} has no calls-times-uses rescan`);
  }
  assert.equal(first.reads.selectedCalls, 32, "only lexical qualification reads the 32 calls");
  assert.equal(second.reads.selectedCalls, 64, "only lexical qualification reads the 64 calls");
});

test("source callable query factories never share proofs between analyses", () => {
  const current = checkedFixture(repeatedCalls(4));
  const first = observedQueries(current);
  const second = observedQueries(current);
  assert.equal(first.queries.borrowedReturn(current.declaration)?.parameter === current.parameter, true);
  assert.equal(first.queries.borrowedReturn(current.declaration) === second.queries.borrowedReturn(current.declaration), false,
    "separate eager analyses own separate completed relation objects");
  assert.equal(second.queries.borrowedReturn(current.declaration)?.parameter === current.parameter, true);
  assert.deepEqual(second.reads, first.reads, "even reused immutable source nodes receive a separate analysis cache");
  const changed = fixture(`export function run(value: string) {
    const read = (input: string): string => { input = "changed"; return input; };
    return read(value) === value;
  }`);
  assert.equal(changed.selected === undefined, true, "equal authored identities do not reuse another program's proof");
});

for (const [name, text, lexical] of [
  ["escaping callable", `export function run() { const read = (value: string) => value; return read; }`, false],
  ["owned mutated input", `export function run(value: string) {
    const read = (input: string): string => { input = "changed"; return input; };
    return read(value) === value;
  }`, true],
]) {
  test(`source callable queries retain negative proof results for ${name}`, () => {
    const current = checkedFixture(text);
    const { queries, reads } = observedQueries(current);
    assert.equal(queries.directLexicalBinding(current.declaration) === current.binding, lexical);
    const selected = queries.borrowedReturn(current.declaration);
    assert.equal(selected?.parameter === current.parameter, name === "escaping callable",
      "escaping changes the callable boundary, not an immutable body's return relation");
    const first = { ...reads };
    for (let iteration = 0; iteration < 128; iteration++) {
      assert.equal(queries.directLexicalBinding(current.declaration) === current.binding, lexical);
      assert.equal(queries.borrowedReturn(current.declaration) === selected, true);
    }
    assert.deepEqual(reads, first, "rejection is memoized without weakening the proof");
  });
}

test("checked original native completion observer returns its exact borrowed input", () => {
  const current = fixture(closedUnionCallbackCompletionSource);
  assert.equal(current.selected === current.parameter, true, "exact input identity without native Future cloning");
});

test("identity-return borrowing permits side effects and repeated comparison calls", () => {
  const current = fixture(`export function run(value: string): boolean {
    let count = 0;
    const read = (input: string): string => { count++; return input; };
    return read(value) === value && read(value) !== "" && count === 2;
  }`);
  assert.equal(current.selected === current.parameter, true, "side effects remain in the callable");
});

test("native lexical function declarations share the exact identity-return owner", () => {
  const current = fixture(`export function run(value: string): boolean {
    function read(input: string): string { return input; }
    return read(value) === value;
  }`);
  assert.equal(current.selected === current.parameter, true, "declared functions use the same loan proof");
});

for (const [name, source, valid] of [
  ["early invocation", `export function run() { const result = read("first"); const read = (value: string) => value; return result; }`, false],
  ["escaped identity", `export function run() { const read = (value: string) => value; return read; }`, true],
  ["captured invocation", `export function run() { const read = (value: string) => value; const later = () => read("first"); return later; }`, true],
  ["lexical receiver", `class Reader { value = "first"; run() { const read = (input: string) => input === this.value; return read(this.value); } }`, true],
  ["selected callable-type boundary", `export function run() { const read: (value: string) => string = value => value; return read("first") === "first"; }`, true],
  ["mutable binding", `export function run() { let read = (value: string) => value; read = value => value + "changed"; return read("first"); }`, true],
]) {
  test(`direct lexical arrow selection rejects ${name}`, () => {
    const current = fixture(source, "read", valid);
    assert.equal(current.direct, false, "source identity and activation remain authoritative");
    assert.equal(current.selected === current.parameter, name !== "lexical receiver",
      "only the declaration body decides its return relation; lexical eligibility remains independent");
  });
}

for (const [name, body] of [
  ["parameter mutation", `const read = (input: string): string => { input = "changed"; return input; }; return read(value) === value;`],
  ["captured input mutation", `const read = (input: string): string => { value = "changed"; return input; }; return read(value) === "first";`],
  ["comparison operand mutation", `const read = (input: string): string => input; return read(value) === (value = "changed");`],
  ["comparison operand invocation", `const read = (input: string): string => input; const change = (): string => { value = "changed"; return value; }; return read(value) === change();`],
  ["transitive captured mutation", `function change(): void { value = "changed"; } const read = (input: string): string => { change(); return input; }; return read(value) === "first";`],
  ["aliased field input", `const box = { value }; const alias = box; const read = (input: string): string => { box.value = "changed"; return input; }; return read(alias.value) === "first";`],
  ["aliased element input", `const values = [value]; const alias = values; const read = (input: string): string => { values[0] = "changed"; return input; }; return read(alias[0]!) === "first";`],
  ["effectful additional argument", `const read = (input: string, other: string): string => input; return read(value, value = "changed") === "first";`],
  ["invoking comparison consumer", `const read = (input: string): string => input; const other = (): string => "first"; return read("first") === other();`],
  ["invoking additional argument", `const read = (input: string, other: string): string => input; const other = (): string => "first"; return read("first", other()) === "first";`],
  ["logical value propagation", `const read = (input: string): string => input; const other = (): string => "first"; return (read(value) || "") === other();`],
  ["conditional value propagation", `const read = (input: string): string => input; return (value.length > 0 ? read(value) : "") === "first";`],
  ["parameter capture", `const read = (input: string): string => { const captured = () => input; captured(); return input; }; return read(value) === value;`],
  ["different return origin", `const read = (input: string): string => input.length > 0 ? input : "fallback"; return read(value) === value;`],
  ["escaping returned value", `const read = (input: string): string => input; return read(value);`],
  ["stored returned value", `const read = (input: string): string => input; const stored = read(value); return stored === value;`],
  ["escaping callable", `const read = (input: string): string => input; return read;`],
  ["omitted source input", `const read = (input: string | void): string | void => input; return read() === undefined && read(value) === value;`],
  ["discarded result", `const read = (input: string): string => input; read(value); return true;`],
  ["suspension", `const read = async (input: string): Promise<string> => input; return read(value) !== undefined;`],
]) {
  test(`identity-result borrowing uses only the declaration body for ${name}`, () => {
    const current = fixture(`export function run(value: string) { ${body} }`);
    const ownBodyRefusesLoan = ["parameter mutation", "parameter capture", "different return origin", "suspension"].includes(name);
    assert.equal(current.selected === undefined, ownBodyRefusesLoan,
      "input mutation/capture/mixed origins/suspension prevent loans; actual caller and result uses do not retarget the declaration");
  });
}
