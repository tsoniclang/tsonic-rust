import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const code = "TSONIC_GENERIC_ASYNC_ADOPTION_UNSUPPORTED";
const identity = "async function identity<Value>(value: Value) { return value; }";
function sourcePosition(ast, node, finish = false) {
  const bytes = Buffer.from(ast.getSourceText(ast.getSourceFile(node)));
  const leading = /^[\t\n\v\f\r ]*/u.exec(bytes.subarray(ast.pos(node), ast.end(node)).toString("utf8"))[0];
  const position = finish ? ast.end(node) : ast.pos(node) + Buffer.byteLength(leading);
  const lines = bytes.subarray(0, position).toString("utf8").split(/\r\n|\r|\n/u);
  return { line: lines.length, column: [...lines.at(-1)].length + 1 };
}
function sourceSpan(ast, node) {
  const start = sourcePosition(ast, node);
  const finish = sourcePosition(ast, node, true);
  return { fileName: "index.ts", ...start, endLine: finish.line, endColumn: finish.column };
}
function rejected(compilation, text, kind, declarationName) {
  assertRejectedAsyncSource(compilation, [{ code, kind, text }]);
  const { ast } = compilation.source;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  compilation.source.sourceFiles.filter(file => file !== undefined && !ast.isDeclarationFile(file)).forEach(visit);
  const issue = compilation.result.diagnostics[0];
  assert.deepEqual(issue.sourceSpan, sourceSpan(ast, issue.sourceNode), "the original instantiation has its exact canonical source span");
  assert.equal(issue.evidence.length, 2, "exactly two related locations, with the signed capability in the code and message");
  for (const [index, label] of ["declaration", "first-sensitive-operation"].entries()) {
    const candidates = nodes.filter(node => {
      const position = sourcePosition(ast, node);
      return `${label} index.ts:${position.line}:${position.column}` === issue.evidence[index];
    });
    assert.equal(candidates.length > 0, true, `${label}: exact related original source coordinates`);
    if (label === "declaration") assert.equal(candidates.some(node => ast.typeParameters(node).length > 0 &&
      (declarationName === undefined || ast.text(ast.name(node)) === declarationName)), true,
    "the related declaration owns the actual selected generic binder");
  }
  return issue;
}
const cases = [
  ["direct", identity, "identity"],
  ["forward-await", `${identity}\nasync function outer<Value>(value: Value): Promise<void> { await identity(value); }`, "outer"],
  ["forward-local", `${identity}\nasync function outer2<Value>(value: Value): Promise<number> { const result = await identity(value); return 0; }`, "outer2"],
  ["forward-discard", `${identity}\nfunction sync<Value>(value: Value): void { void identity(value); }`, "sync"],
  ["forward-pending", `async function later<Value>(value: Value, pending: Promise<void>) { await pending; return value; }
    async function outer3<Value>(value: Value): Promise<void> { await later(value, Promise.resolve(undefined)); }`, "outer3"],
  ["resolve", "function wrap<Value>(value: Value): void { void Promise.resolve(value); }", "wrap"],
  ["named-executor", `function namedExecutor<Value>(value: Value) {
    function execute(resolve: (value: Value | PromiseLike<Value>) => void): void { resolve(value); }
    return new Promise<Value>(execute);
  }`, "namedExecutor"],
  ["nested-return", "function make<Value>(value: Value): { read(): Promise<Value> } { return { async read(): Promise<Value> { return value; } }; }", "make"],
  ["called-nested", "function consume<Value>(value: Value) { async function inner() { return value; } return inner(); }", "consume"],
  ["hoisted-call", "function consume<Value>(value: Value) { return inner(); async function inner() { return value; } }", "consume"],
  ["returned-arrow", "function consume<Value>(value: Value) { return async () => value; }", "consume"],
  ["stored-arrow", "function consume<Value>(value: Value) { const queue: (() => Promise<Value>)[] = []; const later = async () => value; queue.push(later); }", "consume"],
  ["invoked-arrow", "function consume<Value>(value: Value) { return (async () => value)(); }", "consume"],
  ["overloaded", "function identity2<Value>(value: Value): Promise<Value>; async function identity2<Value>(value: Value): Promise<Value> { return value; }", "identity2"],
];

for (const [name, declarations, invoked] of cases) {
  test(`Rust generic adoption refuses the actual Promise-valued ${name} site before sealing`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${declarations}
      export function reject(promised: Promise<number>): void { void ${invoked}(promised); }` } });
    rejected(compilation, `${invoked}(promised)`, "KindCallExpression", invoked);
    assert.equal(compilation.result.diagnostics[0].message.includes("capability C15, frozen"), true,
      "the explicit frozen capability is named rather than silently nesting the native payload");
  });
  test(`Rust generic adoption keeps the ordinary actual for ${name}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `${declarations}
      export function ordinary(value: number): void { void ${invoked}(value); }` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    assert.equal(result.program !== undefined && result.artifacts.length > 0, true,
      "ordinary generic payloads retain their native definition and ABI");
  });
}

test("Rust adoption provenance has the same fixed Unicode/CRLF payload as C#", () => {
  const source = 'const marker = "界😀";\r\nasync function identity<Value>(value: Value) {\r\n\treturn value;\r\n}\r\n' +
    "export function reject(promised: Promise<number>): void {\r\n\tvoid identity(promised);\r\n}";
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(compilation.harness.paths.projectRoot, "/src", "the actual Rust root differs from the paired C# checkout");
  const issue = rejected(compilation, "identity(promised)", "KindCallExpression", "identity");
  assert.deepEqual(issue.sourceSpan, { fileName: "index.ts", line: 6, column: 7, endLine: 6, endColumn: 25 },
    "exact actual instantiation coordinates, not the related declaration");
  assert.deepEqual(issue.evidence, ["declaration index.ts:2:1", "first-sensitive-operation index.ts:3:2"],
    "byte-identical to the paired C# expectation, independent of the physical checkout");
});

test("Rust generic class adoption is refused at the checked constructor", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
    class Holder<Value> { constructor(readonly value: Value) {} async get(): Promise<Value> { return this.value; } }
    export function reject(promised: Promise<number>): void { void new Holder(promised); }
  ` } });
  rejected(compilation, "new Holder(promised)", "KindNewExpression", "Holder");
});

for (const [name, body] of [
  ["unused-named", "async function unused() { return value; } return 1;"],
  ["discarded-arrow", "async () => value; return 1;"],
  ["type-only", "async function unused() { return value; } type OnlyType = typeof unused; return 1;"],
  ["erased-forwarding", "function unused() { return identity(value); } return 1;"],
]) {
  test(`Rust erases ${name} without refusing or executing its generic async body`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "generic_erased_adoption" } },
      files: { "index.ts": `${identity}\nfunction consume<Value>(value: Value): number { ${body} }
        console.log(consume(Promise.resolve(1)));` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const executed = validateGeneratedProject(`generic-erased-${name}`, result.artifacts, { run: true });
    assert.equal(executed.stdout.trim(), "1", "only the retained consume body runs");
  });
}

for (const declaration of [
  "interface Contract { identity<Value>(value: Value): Promise<Value>; }",
  "abstract class Contract { abstract identity<Value>(value: Value): Promise<Value>; }",
]) {
  test(`Rust generic adoption keeps its unknown ${declaration.startsWith("interface") ? "interface" : "abstract"} signature`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${declaration}
      export function reject(contract: Contract, promised: Promise<number>): void { void contract.identity(promised); }` } });
    rejected(compilation, "contract.identity(promised)", "KindCallExpression", "identity");
  });
}

test("Rust unknown source generic bodies fail closed at their actual instantiation", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function reject(callback: <Value>(value: Value) => Promise<Value>, promised: Promise<number>): void {
      void callback(promised);
    }
  ` } });
  rejected(compilation, "callback(promised)", "KindCallExpression");
});

test("Rust ordinary library generics and constrained native values do not acquire an adoption refusal", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    async function primitive<Value extends number>(value: Value): Promise<Value> { return value; }
    export async function run(): Promise<number> { return await primitive(7); }
  ` } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(result.program !== undefined, true, "a native primitive constraint is a checked non-adopting contract");
  for (const source of [
    "export async function run(): Promise<number[]> { return await Promise.all([1, 2].map(async value => value)); }",
    "export function run(): Promise<number>[] { return [1, 2].map(async value => value); }",
    "async function worker(): Promise<number> { return 7; } export async function run(): Promise<number[]> { return await Promise.all([worker(), worker()]); }",
  ]) {
    const compiled = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(compiled.result.diagnostics.filter(issue => issue.code === code).length, 0,
      "ambient library binders keep their existing lowering outcome, not the source-generic boundary");
  }
});
