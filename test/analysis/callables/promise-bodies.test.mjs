import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/target-program.js";
import { isRustNativeFutureCarrier } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { suspendedCallbackInputsSource } from "../../../../tsonic/test/fixtures/suspended-callback-inputs.mjs";

const header = `import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";`;

function analyze(text) {
  let context;
  let program;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
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
  assert.equal(current.context.promiseBodies.plan.objects.get(current.named("read")) === issues[0].sourceNode, true);
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
