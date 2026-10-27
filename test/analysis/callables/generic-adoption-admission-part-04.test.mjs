import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  diagnosticSummary,
  code,
  identity,
  nativeEntryCases,
  nativeEntryInverses,
  nativeOpaquePayloadCases,
  nativeConstructorCases,
  nativeConstructorInverses,
  sourcePosition,
  sourceSpan,
  rejected,
  cases,
} from "./generic-adoption-admission-fixtures.mjs";

for (const [name, declarations, expression] of (nativeOpaquePayloadCases).slice(5, 6)) {
test("Rust ordinary opaque callable input keeps its native value: " + name, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: "ordinary_native_opaque_payload" } }, files: { "index.ts": "export {};\n" + declarations + "\nconsole.log(await wrap(7));" } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result, source));
    assert.equal(validateGeneratedProject("ordinary-native-opaque-" + name, result.artifacts, { run: true }).stdout.trim(), "7",
      "ordinary Awaited identity does not add a refusal or alter the native callback result");
  });
}

for (const [name, declarations, expression] of (nativeOpaquePayloadCases).slice(6, 18)) {
test("Rust native opaque callable input is unresolved, not safe empty: " + name, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": declarations +
      "\nexport function reject(value: Promise<number>): void { void wrap(value); }" } });
    assertRejectedAsyncSource(compilation, [{ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", kind: "KindCallExpression", text: expression }]);
  });

test("Rust ordinary opaque callable input keeps its native value: " + name, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: "ordinary_native_opaque_payload" } }, files: { "index.ts": "export {};\n" + declarations + "\nconsole.log(await wrap(7));" } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result, source));
    assert.equal(validateGeneratedProject("ordinary-native-opaque-" + name, result.artifacts, { run: true }).stdout.trim(), "7",
      "ordinary Awaited identity does not add a refusal or alter the native callback result");
  });
}

for (const [name, declarations] of nativeConstructorCases) {
  test("Rust official native constructor keeps exact generic adoption: " + name, () => {
    const compiled = compileRust({ surfaces: [], files: { "index.ts": declarations +
      "\nexport function reject(promised: Promise<number>): void { void wrap(promised); }" } });
    rejected(compiled, "wrap(promised)", "KindCallExpression", "wrap");
  });
  test("Rust official native constructor preserves its ordinary native value: " + name, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: [],
      target: { id: "rust", options: { outputType: "bin", crateName: "official_constructor" } },
      files: { "index.ts": "export {};\n" + declarations + "\nif ((await wrap(7)) !== 7) throw new Error(\"ordinary constructor payload\");" } });
    assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    assert.equal(validateGeneratedProject("official-constructor-" + name, result.artifacts, { run: true }).status, 0,
      "the exact officially selected native constructor preserves the ordinary payload");
  });
}

for (const [name, sourceText] of nativeConstructorInverses) {
  test("Rust official native constructor inverse: " + name, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: [],
      target: { id: "rust", options: { outputType: "bin", crateName: "official_constructor_inverse" } },
      files: { "index.ts": "export {};\n" + sourceText } });
    assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    assert.equal(validateGeneratedProject("official-constructor-inverse-" + name, result.artifacts, { run: true }).status, 0,
      "foreign identity and nonresolving callbacks never manufacture adoption");
  });
}

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

test("adoption provenance carries its fixed Unicode/CRLF payload independent of the project root", () => {
  const source = 'const marker = "界😀";\r\nasync function identity<Value>(value: Value) {\r\n\treturn value;\r\n}\r\n' +
    "export function reject(promised: Promise<number>): void {\r\n\tvoid identity(promised);\r\n}";
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(compilation.harness.paths.projectRoot, "/src", "the project root is part of the proof");
  const issue = rejected(compilation, "identity(promised)", "KindCallExpression", "identity");
  assert.deepEqual(issue.sourceSpan, { fileName: "index.ts", line: 6, column: 7, endLine: 6, endColumn: 25 },
    "exact actual instantiation coordinates, not the related declaration");
  assert.deepEqual(issue.evidence, ["declaration index.ts:2:1", "first-sensitive-operation index.ts:3:2"],
    "byte-identical, independent of the physical checkout");
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
    files: { "index.ts": `export {};
      class Holder<Value> { constructor(readonly value: Value) {}
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

for (const recursive of ([false, true]).slice(0, 1)) {
const helper = recursive ? `function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) bounce(callback, value, count - 1); else callback(value);
  } function bounce<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) deliver(callback, value, count - 1); else callback(value);
  }` : "function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void { callback(value); }";

test(`Rust retains ${recursive ? "recursive" : "direct"} resolver/value correlation in native execution`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: `resolver_${recursive ? "recursive" : "direct"}_rows` } }, files: { "index.ts": `export {};
      ${helper}
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
