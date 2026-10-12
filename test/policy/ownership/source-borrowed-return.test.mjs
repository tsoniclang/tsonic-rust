import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, Node_Initializer } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { rustSourceBorrowedReturnParameter } from "../../../dist/policy/ownership/source-borrowed-return.js";
import { rustDirectLexicalCallableBinding } from "../../../dist/policy/ownership/source-lexical-callable.js";
import { closedUnionCallbackCompletionSource } from "../../../../tsonic/test/fixtures/closed-union-callback-completion.mjs";

function fixture(text, name = "read", valid = true) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project",
    files: { "/project/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  if (valid) assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const sourceFile = checked.getSourceFile("/project/index.ts");
  assert.equal(sourceFile !== undefined, true, "checked source exists");
  const sourceStorage = createSourceStorageQuery(source, [sourceFile]);
  const binding = sourceStorage.nodes.find(node => source.ast.text(source.ast.name(node)) === name &&
    (source.ast.is.IsVariableDeclaration(node) || source.ast.is.IsFunctionDeclaration(node)));
  const declaration = source.ast.is.IsVariableDeclaration(binding) ? Node_Initializer(source.ast, binding) : binding;
  assert.equal(declaration !== undefined, true, "exact callable declaration");
  return { declaration, parameter: source.ast.parameters(declaration)[0],
    direct: rustDirectLexicalCallableBinding(declaration, source) === binding,
    selected: rustSourceBorrowedReturnParameter(declaration, {
      ast: source.ast, source, sourceStorage, semanticsFor: source.semantics.forNode,
    }) };
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
    assert.equal(current.selected === undefined, true, "no unsupported escaping or eager loan ABI");
  });
}

for (const [name, body] of [
  ["parameter mutation", `const read = (input: string): string => { input = "changed"; return input; }; return read(value) === value;`],
  ["parameter capture", `const read = (input: string): string => { const captured = () => input; captured(); return input; }; return read(value) === value;`],
  ["different return origin", `const read = (input: string): string => input.length > 0 ? input : "fallback"; return read(value) === value;`],
  ["escaping returned value", `const read = (input: string): string => input; return read(value);`],
  ["stored returned value", `const read = (input: string): string => input; const stored = read(value); return stored === value;`],
  ["escaping callable", `const read = (input: string): string => input; return read;`],
  ["omitted source input", `const read = (input: string | void): string | void => input; return read() === undefined && read(value) === value;`],
  ["discarded result", `const read = (input: string): string => input; read(value); return true;`],
  ["suspension", `const read = async (input: string): Promise<string> => input; return read(value) !== undefined;`],
]) {
  test(`identity-result borrowing keeps ownership for ${name}`, () => {
    const current = fixture(`export function run(value: string) { ${body} }`);
    assert.equal(current.selected === undefined, true, "unproved borrow is not selected");
  });
}
