import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/target-program.js";
import { isRustNativeFutureCarrier } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { suspendedCallbackInputsSource } from "../../../../tsonic/test/fixtures/suspended-callback-inputs.mjs";
import { selectRustSourcePackageComponentIdentities } from "../../../dist/analysis/program/source-package-components.js";
import { sourcePackageGraphFixture } from "../../../../tsonic/test/fixtures/source-package-graph.mjs";

const header = `import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";`;

function analyze(text, options = {}) {
  let context;
  let program;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, ...options, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    const analyzed = analyzeRustTargetProgram(request);
    if (analyzed.kind === "rejected") return analyzed;
    program = analyzed.value;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
  } });
  const declarations = context.sourceStorage.nodes.filter(node => context.records.asyncFunction.get(node) !== undefined);
  const named = name => declarations.find(node => context.ast.name(node) !== undefined &&
    context.ast.text(context.ast.name(node)) === name);
  const calls = context.sourceStorage.nodes.filter(node => context.records.targetOperation.get(node)?.kind === "source-call");
  return { context, result, program, named, calls };
}

test("an immediate native body keeps its borrowed storage before effects instead of demanding an owned object", () => {
  const current = analyze(`${header}
async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
async function outer<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  return await read(value, pending);
}
export const marker = 0;`);
  assert.deepEqual(current.result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const declaration = current.named("read");
  const fact = current.context.records.asyncFunction.get(declaration);
  assert.equal(fact.lowering.kind, "factory");
  assert.equal(fact.lowering.storage.kind === "static", false);
  assert.equal(current.context.promiseBodies.plan.objects.has(declaration), false);
  const call = current.calls.find(node => current.context.records.targetOperation.get(node).asyncBody?.declaration === declaration);
  assert.equal(call !== undefined, true);
  const operation = current.context.records.targetOperation.get(call);
  assert.equal(isRustNativeFutureCarrier(operation.resultCarrier), true);
  assert.equal(rustJsPromiseOutputTargetType(operation.asyncBody.logicalResultCarrier) !== undefined, true);
});

test("native body and actual object demands remain distinct for mixed invocation uses", () => {
  const current = analyze(`${header}
async function read(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }
async function outer(pending: Promise<void>): Promise<int32> {
  const value: int32 = 1;
  const first = await read(value, pending);
  const stored = read(value, pending);
  return first + await stored;
}
export const marker = 0;`);
  assert.deepEqual(current.result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const declaration = current.named("read");
  assert.equal(current.context.promiseBodies.plan.objects.has(declaration), true);
  const calls = current.calls.filter(node => current.context.ast.text(Node_Expression(current.context.ast, node)) === "read");
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(node => current.context.records.targetOperation.get(node).asyncBody !== undefined).length, 1);
  assert.equal(calls.filter(node => rustJsPromiseOutputTargetType(current.context.records.targetOperation.get(node).resultCarrier) !== undefined).length, 1);
});

test("a stored borrowed body is refused at the object demand, not its declaration", () => {
  const current = analyze(`${header}
async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending; return load(value);
}
async function outer<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  const stored = read(value, pending);
  return await stored;
}
export const marker = 0;`);
  const issues = current.result.diagnostics.filter(value => value.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN");
  assert.equal(issues.length, 1);
  const call = current.calls.find(node => current.context.ast.text(Node_Expression(current.context.ast, node)) === "read");
  assert.equal(issues[0].sourceNode === call, true);
  const demands = current.context.promiseBodies.plan.objects.get(current.named("read"));
  assert.equal(demands?.length === 1 && demands[0] === issues[0].sourceNode, true,
    "the single actual object demand retains its exact checked call identity");
  assert.equal(current.program === undefined && current.result.artifacts.length === 0, true);
});

test("a real library export demands an object without changing an internal immediate body's selection", () => {
  const current = analyze(`${header}
async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending; return load(value);
}
export async function outer<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  return await read(value, pending);
}`);
  const issues = current.result.diagnostics.filter(value => value.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].sourceNode === current.named("outer"), true);
  assert.equal(current.context.promiseBodies.plan.objects.has(current.named("read")), false);
  assert.equal(current.calls.some(node => current.context.records.targetOperation.get(node).asyncBody?.declaration === current.named("read")), true);
  assert.equal(current.program === undefined && current.result.artifacts.length === 0, true);
});

for (const [name, body] of [
  ["read", "await pending; return load(value);"],
  ["readFirst", "const copied = load(value); await pending; return copied;"],
]) {
  for (const demand of ["stored", "passed", "first-class", "public", "cross-component"]) {
    test(`${name} refuses precisely its genuine ${demand} object demands`, () => {
      const declaration = `${demand === "public" || demand === "cross-component" ? "export " : ""}async function ${name}<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> { ${body} }`;
      const use = demand === "stored" ? `const stored = ${name}(value, pending); return await stored;`
        : demand === "passed" ? `return await settle(${name}(value, pending));`
          : demand === "first-class" ? `const selected = ${name}; return await selected(value, pending);`
            : `return await ${name}(value, pending);`;
      const root = `${header}\n${demand === "cross-component" ? `import { ${name} } from "@acme/read";` : declaration}
async function settle(pending: Promise<int32>): Promise<int32> { return await pending; }
async function outer<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  ${use}
}
export const marker = 0;`;
      const files = demand === "cross-component" ? { "index.ts": root,
        "node_modules/@acme/read/package.json": JSON.stringify({ name: "@acme/read", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
        "node_modules/@acme/read/index.ts": `${header}\n${declaration}` } : { "index.ts": root };
      const current = analyze(root, { files, ...(demand === "cross-component" ? {
        sourcePackages: sourcePackageGraphFixture(["index.ts"], { "@acme/read": { files: ["index.ts"], dependencies: [] } }),
      } : {}) });
      const selected = current.named(name);
      assert.equal(selected !== undefined, true, "the actual generic borrowed body was analyzed");
      const demands = current.context.promiseBodies.plan.objects.get(selected);
      assert.equal(demands !== undefined && demands.length > 0, true, "the actual object facet has recorded source demands");
      const issues = current.result.diagnostics.filter(issue => issue.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN");
      assert.equal(issues.length, demands.length, "every object demand, and no guessed declaration, receives its refusal");
      for (const node of demands) assert.equal(issues.filter(issue => issue.sourceNode === node).length, 1,
        "each refusal retains the identical recorded source demand node");
      assert.equal(issues.every(issue => issue.message === "A suspending JS Promise body cannot retain a borrowed value across a pending point; its task requires owned storage."), true,
        "the native object-factory restriction is precise");
      assert.equal(current.program === undefined && current.result.artifacts.length === 0, true,
        "a rejected object facet is never published or rendered");
    });
  }
}

function lower(text) {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text } });
  assert.deepEqual(result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  return rustSourceText(result);
}

test("a borrowed immediate call emits one native body without a task, Promise object or static input bound", () => {
  const rust = lower(`${header}
async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending; return load(value);
}
async function outer<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  return await read(value, pending);
}
export const marker = 0;`);
  assert.match(rust, /async fn read_native<'Region>/u);
  assert.match(rust, /read_native\(value, pending\)\.await/u);
  assert.equal(rust.includes("from_fallible_factory") || rust.includes("from_infallible_factory"), false);
  assert.equal(rust.includes("fn read("), false);
  assert.equal(rust.includes("'Region: 'static"), false);
});

test("mixed call uses emit one body and a distinct demanded object adapter, not a duplicate source body", () => {
  const rust = lower(`${header}
async function read(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }
async function outer(pending: Promise<void>): Promise<int32> {
  const value: int32 = 1;
  const first = await read(value, pending);
  const stored = read(value, pending);
  return first + await stored;
}
export const marker = 0;`);
  assert.equal((rust.match(/async fn read_native\(/gu) ?? []).length, 1);
  assert.equal((rust.match(/fn read\(/gu) ?? []).length, 1);
  assert.match(rust, /read_native\(value, pending\)\.await/u);
  assert.match(rust, /from_fallible_factory/u);
});

test("a settled direct call uses the same canonical body owner without the superseded settled helper path", () => {
  const rust = lower(`${header}
async function read(value: int32): Promise<int32> { return value; }
async function outer(value: int32): Promise<int32> { return await (read(value)); }
export const marker = 0;`);
  assert.match(rust, /fn read_native\(value: i32\) -> i32/u);
  assert.match(rust, /read_native\(value\)/u);
  assert.equal(rust.includes("read_settled") || rust.includes("read_native(value).await"), false);
  assert.equal(rust.includes("JsPromise::resolved"), false);
});

test("sum and Reader.sum keep borrowed callback implementations on the direct native body edge", () => {
  const rust = lower(suspendedCallbackInputsSource);
  assert.match(rust, /async fn sum_native</u);
  assert.match(rust, /sum_native\(/u);
  assert.match(rust, /\.sum_native\(/u);
  assert.equal((rust.match(/async fn sum_native</gu) ?? []).length, 2);
});

test("invoke preserves the exact int64 callback completion on its native body", () => {
  const rust = lower(`import type { int64 } from "@tsonic/core/types.js";
async function read(value: int64): Promise<int64> { return value; }
async function invoke(callback: (value: int64) => Promise<int64>, value: int64): Promise<int64> {
  return await callback(value);
}
export async function main(): Promise<void> {
  const value: int64 = 1n;
  if (await invoke(read, value) !== value) throw new Error("invoke");
}`);
  assert.match(rust, /async fn invoke_native</u);
  assert.match(rust, /-> Result<\s*i64,/u);
  assert.match(rust, /invoke_native\(/u);
});

test("call retains the existing optional callback absence witness on its native body", () => {
  const rust = lower(`function fail(): never { throw new Error("absent"); }
async function read(): Promise<number> { return 7; }
async function call(callback: (() => Promise<number>) | undefined): Promise<number> {
  return await (callback ?? fail())();
}
export async function main(): Promise<void> { if (await call(read) !== 7) throw new Error("call"); }`);
  assert.match(rust, /async fn call_native</u);
  assert.match(rust, /call_native\(/u);
  assert.match(rust, /Option<Implementation0>/u);
});

test("Work.wait selects its method body rather than constructing an unobserved JS task", () => {
  const rust = lower(`class Work {
  completion: Promise<void> = Promise.resolve(undefined);
  async wait(): Promise<void> { await this.completion; }
}
export async function main(): Promise<void> { const work = new Work(); await work.wait(); }`);
  assert.match(rust, /async fn wait_native\(/u);
  assert.match(rust, /\.wait_native\(\)\.await/u);
});

test("source<Value> and consumer<Actual> keep native generic bodies beside their real public Promise ABI", () => {
  const rust = lower(`export async function source<Value>(callback: () => Promise<Value>) { return await callback(); }
export function retain<Other>(callback: () => Promise<Other>) { return source(callback); }
export async function consumer<Actual>(callback: () => Promise<Actual>) { return await retain(callback); }`);
  assert.match(rust, /async fn source_native</u);
  assert.match(rust, /async fn consumer_native</u);
  assert.match(rust, /pub fn source</u);
  assert.match(rust, /pub fn consumer</u);
  assert.match(rust, /JsPromise<Value>/u);
  assert.match(rust, /JsPromise<Actual>/u);
});

test("a demanded lexical adapter preserves its captured ABI with distinct native and object bounds", () => {
  const rust = lower(`import type { int32 } from "@tsonic/core/types.js";
export async function outer<Value>(value: Value, pending: Promise<void>): Promise<Value> {
  const expected: int32 = 1;
  async function nested(inner: Value): Promise<Value> {
    await pending;
    if (expected !== 1) throw new Error("capture");
    return inner;
  }
  const direct = await nested(value);
  const stored = nested(direct);
  return await stored;
}`);
  const native = rust.match(/async fn ([A-Za-z0-9_]*nested_native)[\s\S]*?\{/u)?.[0];
  const adapter = rust.match(/fn ([A-Za-z0-9_]*nested)(?:<|\()[\s\S]*?\{/u)?.[0];
  assert.equal(native !== undefined && adapter !== undefined, true, "both exact lexical facets are emitted");
  assert.equal(native.includes("'static"), false, "the native body has no object-retention lifetime bound");
  assert.equal(adapter.includes("'static"), true, "the retained object facet has its actual lifetime bound");
  const captureNames = signature => [...signature.matchAll(/\b(__tsonic_capture[A-Za-z0-9_]*|capture[A-Za-z0-9_]*)\s*:/gu)]
    .map(match => match[1]);
  const nativeCaptures = captureNames(native);
  assert.equal(nativeCaptures.length, 2, "checked pending and expected captures participate");
  assert.deepEqual(captureNames(adapter), nativeCaptures, "the full lexical ABI is preserved in order");
});

test("native Promise bodies are private implementation details while authored exports retain their ABI", () => {
  const current = analyze(`${header}
export async function read(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }
export async function outer(value: int32, pending: Promise<void>): Promise<int32> { return await read(value, pending); }`);
  assert.deepEqual(current.result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const declaration = current.named("read");
  assert.equal(current.context.promiseBodies.plan.declarations.get(declaration).visibility, "crate");
  assert.equal(current.context.promiseBodies.plan.objects.has(declaration), true, "the true public object ABI remains demanded");
  const rust = lower(`${header}
export async function read(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }`);
  assert.match(rust, /pub\(crate\) async fn read_native\(/u);
  assert.match(rust, /pub fn read\(/u);
  assert.equal(/pub async fn read_native\(/u.test(rust), false);
});

test("checked component identity admits same-component bodies and preserves an imported package object ABI", () => {
  const files = {
    "index.ts": `import type { int32 } from "@tsonic/core/types.js";
import { read } from "@acme/read";
export async function outer(value: int32, pending: Promise<void>): Promise<int32> { return await read(value, pending); }`,
    "node_modules/@acme/read/package.json": JSON.stringify({ name: "@acme/read", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
    "node_modules/@acme/read/index.ts": `${header}
async function local(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }
export async function read(value: int32, pending: Promise<void>): Promise<int32> { return await local(value, pending); }`,
  };
  const current = analyze(files["index.ts"], { files,
    sourcePackages: sourcePackageGraphFixture(["index.ts"], { "@acme/read": { files: ["index.ts"], dependencies: [] } }),
  });
  assert.deepEqual(current.result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const calls = name => current.calls.filter(node => current.context.ast.text(Node_Expression(current.context.ast, node)) === name);
  const external = calls("read");
  const internal = calls("local");
  assert.equal(external.length, 1);
  assert.equal(internal.length, 1);
  assert.equal(current.context.records.targetOperation.get(external[0]).asyncBody === undefined, true,
    "cross-component invocation retains the public object contract");
  assert.equal(current.context.records.targetOperation.get(internal[0]).asyncBody?.declaration === current.named("local"), true,
    "the same package's internal immediate body remains native");
});

test("the component identity owner refuses missing and conflicting identities before Promise selection", () => {
  const current = analyze(`${header}
async function read(value: int32): Promise<int32> { return value; }
export const marker = 0;`);
  assert.deepEqual(current.result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const graph = current.context.sourcePackages;
  const { ast, sourceFiles } = current.context;
  const missing = selectRustSourcePackageComponentIdentities({ ...graph,
    packages: graph.packages.map(entry => ({ ...entry, sourceFiles: [] })),
  }, ast, sourceFiles);
  assert.equal(missing.kind, "rejected");
  assert.deepEqual(missing.diagnostics.map(issue => issue.code), ["RUST_SOURCE_PACKAGE_COMPONENT_IDENTITY_MISSING"]);
  const root = graph.packages.find(entry => entry.id === graph.rootPackageId);
  const conflict = selectRustSourcePackageComponentIdentities({ ...graph,
    packages: [...graph.packages, { ...root, id: "conflicting-package", componentId: "conflicting-component" }],
    components: [...graph.components, { id: "conflicting-component", packages: ["conflicting-package"], dependencies: [] }],
  }, ast, sourceFiles);
  assert.equal(conflict.kind, "rejected");
  assert.deepEqual(conflict.diagnostics.map(issue => issue.code), ["RUST_SOURCE_PACKAGE_FILE_COMPONENT_CONFLICT"]);
  const identities = current.context.sourcePackageComponentIdentities;
  assert.equal(identities.kind, "resolved");
  const fileName = ast.getFileName(sourceFiles[0]);
  assert.equal(identities.identities.componentIdForFile(fileName), identities.identities.componentIdForFile(fileName.replaceAll("/", "\\")),
    "one canonical file identity is reused across path spellings");
});
