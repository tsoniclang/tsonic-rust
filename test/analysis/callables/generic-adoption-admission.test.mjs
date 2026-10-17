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
    if (label === "declaration") assert.equal(candidates.some(node => nodes.some(parameter =>
      ast.is.IsTypeParameterDeclaration(parameter) && ast.parent(parameter) === node) &&
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
  ["promise-like-reaction", `function likeReaction<Value>(value: Value): void {
    const pending: PromiseLike<number> = Promise.resolve(0); void pending.then(() => value);
  }`, "likeReaction"],
  ["named-executor", `function namedExecutor<Value>(value: Value) {
    function execute(resolve: (value: Value | PromiseLike<Value>) => void): void { resolve(value); }
    return new Promise<Value>(execute);
  }`, "namedExecutor"],
  ["resolver-helper", `function helper<Value>(value: Value) { return new Promise<Value>(resolve => {
    function deliver(callback: (value: Value) => void): void { callback(value); } deliver(resolve);
  }); }`, "helper"],
  ["generic-resolver-helper", `function deliver<Part>(callback: (value: Part) => void, value: Part): void { callback(value); }
    function helper<Value>(value: Value) { return new Promise<Value>(resolve => deliver(resolve, value)); }`, "helper"],
  ["member-resolver", `function helper<Value>(value: Value) { return new Promise<Value>(resolve => {
    const cell = { done: resolve }; const alias = cell.done; alias(value);
  }); }`, "helper"],
  ["typed-returned-executor", `type Executor<Part> = (resolve: (value: Part | PromiseLike<Part>) => void) => void;
    function create<Part>(value: Part): Executor<Part> { return resolve => resolve(value); }
    function helper<Value>(value: Value) { return new Promise<Value>(create(value)); }`, "helper"],
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

test("Rust refuses a known Promise wrapper with a still-free inner payload before physical analysis", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${identity}
    function wrap<Value>(value: Value) { return identity(Promise.resolve(value)); }
    export function run(): void { void wrap(7); }` } });
  rejected(compilation, "identity(Promise.resolve(value))", "KindCallExpression", "identity");
});

for (const [name, extra, receiver] of [
  ["incoming", "", "Holder<Promise<number>>"],
  ["alias", "type Alias<Part> = Holder<Part>;", "Alias<Promise<number>>"],
  ["union", "", "Holder<number> | Holder<Promise<number>>"],
  ["inherited", "class Derived<Part> extends Holder<Part> {}", "Derived<Promise<number>>"],
  ["fixed-inherited", "class Derived extends Holder<Promise<number>> {}", "Derived"],
  ["indexed-inherited", "class Derived<Parts extends unknown[]> extends Holder<Parts[0]> {}", "Derived<[Promise<number>]>"],
  ["wrapped-inherited", "class Derived<Part> extends Holder<Promise<Part>> {}", "Derived<number>"],
  ["conditional-inherited", "class Derived<Part> extends Holder<Part extends number ? number : Promise<number>> {}", "Derived<string>"],
]) {
  test(`Rust generic adoption refuses the actual ${name} class receiver`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
      class Holder<Value> { constructor(readonly value: Value) {} async get(): Promise<Value> { return this.value; } }
      ${extra} export function reject(holder: ${receiver}) { return holder.get(); }
    ` } });
    rejected(compilation, "holder.get()", "KindCallExpression");
  });
}

test("Rust ordinary class receiver retains an executable native payload", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_receiver_payload" } },
    files: { "index.ts": `class Holder<Value> { constructor(readonly value: Value) {}
      async get(): Promise<Value> { return this.value; } }
      async function use(holder: Holder<number>): Promise<number> { return await holder.get(); }
      console.log(await use(new Holder(7)));` } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  const output = validateGeneratedProject("generic-receiver-payload", result.artifacts, { run: true });
  assert.equal(output.stdout.trim(), "7", "ordinary actual receiver bindings remain native and executable");
});

for (const [name, declaration] of [
  ["interface", "interface Contract<Value> { read(): Promise<Value>; }"],
  ["abstract", "abstract class Contract<Value> { abstract read(): Promise<Value>; }"],
  ["callable-property", "interface Contract<Value> { read: () => Promise<Value>; }"],
  ["class-callable-property", `class Contract<Value> { read: () => Promise<Value>;
    constructor(read: () => Promise<Value>) { this.read = read; } }`],
]) {
  test(`Rust generic adoption keeps the unknown ${name} receiver contract`, () => {
    const compiled = compileRust({ surfaces: ["js"], files: { "index.ts": `${declaration}
      export function reject(value: Contract<Promise<number>>) { return value.read(); }` } });
    rejected(compiled, "value.read()", "KindCallExpression");
  });
}

test("Rust ordinary generic source forms retain their complete native build and execution", { timeout: 300_000 }, () => {
  const files = Object.fromEntries(cases.map(([, declarations, invoked], index) => [`form${index}.ts`, `${declarations}
    export function ordinary(value: number): void { void ${invoked}(value); }`]));
  const entry = cases.map((_, index) => `import { ordinary as call${index} } from "./form${index}.js";`).join("\n") +
    cases.map((_, index) => `call${index}(7);`).join("\n") + "\nconsole.log(7);";
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
    crateName: "ordinary_generic_forms" } }, files: { ...files, "index.ts": entry } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  const output = validateGeneratedProject("ordinary-generic-forms", result.artifacts, { run: true });
  assert.equal(output.stdout.trim(), "7", "every ordinary form runs under the real native event-loop owner");
});

for (const recursive of [false, true]) {
  const helper = recursive ? `function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) bounce(callback, value, count - 1); else callback(value);
  } function bounce<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) deliver(callback, value, count - 1); else callback(value);
  }` : "function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void { callback(value); }";
  test(`Rust retains ${recursive ? "recursive" : "direct"} resolver/value correlation in native execution`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: `resolver_${recursive ? "recursive" : "direct"}_rows` } }, files: { "index.ts": `${helper}
      function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => {
        deliver(resolve, 7, 2); deliver(item => { void item; }, value, 2);
      }); }
      console.log(await wrap(Promise.resolve(11)));` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const executed = validateGeneratedProject(`resolver-${recursive ? "recursive" : "direct"}-rows`, result.artifacts, { run: true });
    assert.equal(executed.stdout.trim(), "7", "the Promise-valued actual reaches only the ordinary callback");
  });
  test(`Rust refuses the matching ${recursive ? "recursive" : "direct"} adopting resolver row`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${helper}
      function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => deliver(resolve, value, 2)); }
      export function reject(promised: Promise<number>): void { void wrap(promised); }` } });
    rejected(compilation, "wrap(promised)", "KindCallExpression", "wrap");
  });
}

test("Rust keeps opaque resolver provenance explicitly unresolved for a Promise-valued actual", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `declare function opaque<Value>(value: Value): Value;
    function wrap<Value>(value: Value) { return new Promise<Value>(resolve => { const done = opaque(resolve); done(value); }); }
    export function reject(promised: Promise<number>): void { void wrap(promised); }` } });
  assertRejectedAsyncSource(compilation, [{ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", kind: "KindCallExpression", text: "done(value)" }]);
});

test("Rust preserves an ordinary native actual despite an open symbolic resolver alias", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "ordinary_resolver_alias" } }, files: { "index.ts": `
      type Alias<Value> = (resolve: (value: Value) => void) => (value: Value) => void;
      function wrap<Value>(value: Value, alias: Alias<Value>): Promise<Value> {
        return new Promise<Value>(resolve => { const done = alias(resolve); done(value); });
      }
      if (await wrap<number>(7, resolve => resolve) !== 7) throw new Error("ordinary resolver alias");` } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(validateGeneratedProject("ordinary-resolver-alias", result.artifacts, { run: true }).status, 0,
    "a proven non-adopting ordinary payload retains its complete native callback and value behavior");
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
