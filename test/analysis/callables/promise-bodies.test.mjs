import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { isRustNativeFutureCarrier } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../dist/target-model/types/carriers/promises.js";

const header = `import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";`;

function analyze(text) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  const declarations = context.sourceStorage.nodes.filter(node => context.records.asyncFunction.get(node) !== undefined);
  const named = name => declarations.find(node => context.ast.name(node) !== undefined &&
    context.ast.text(context.ast.name(node)) === name);
  const calls = context.sourceStorage.nodes.filter(node => context.records.targetOperation.get(node)?.kind === "source-call");
  return { context, result, named, calls };
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
  const calls = current.calls.filter(node => current.context.ast.text(node).startsWith("read("));
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
  assert.equal(current.context.ast.text(issues[0].sourceNode), "read(value, pending)");
  assert.equal(current.context.promiseBodies.plan.objects.get(current.named("read")).at === issues[0].sourceNode, true);
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
});
