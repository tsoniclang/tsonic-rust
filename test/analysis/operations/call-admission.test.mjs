import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { selectRustCheckedCall, finalizeRustPreparedCheckedCall } from "../../../dist/analysis/operations/selected-calls.js";
import { rustOperationContext } from "../../../dist/analysis/program/walk.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { admitRustOperationSelection } from "../../../dist/analysis/operations/operation-admission.js";

const forbidden = new Proxy({}, { get() { throw new Error("a completed request re-entered native resolution"); } });

for (const [name, text, options] of [
  ["native default", 'import type { int32 } from "@tsonic/core/types.js"; import { defaultvalue } from "@tsonic/core/lang.js"; export function value(): int32 { return defaultvalue<int32>(); }', { surfaces: [] }],
  ["JS native operation", "export function value(input: number): number { return Math.abs(input); }", { surfaces: ["js"] }],
  ["signature only", 'import type { int32 } from "@tsonic/core/types.js"; export function invoke(callback: (value: int32) => int32, value: int32): int32 { return callback(value); }', { surfaces: [] }],
]) test(`${name} checked calls resolve and admit once per source transaction`, () => {
  const { context, walk, admissions, requestFor } = analyzeRustOperations(text, options);
  const call = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  assert.equal(call !== undefined, true);
  const request = requestFor(call);
  const before = Object.fromEntries(Object.entries(admissions).map(([family, counts]) => [family, [...counts]]));
  const completed = walk.operationAttempts.get(call);
  assert.equal(completed?.kind, "checked-call");
  const current = rustOperationContext(walk, call);
  const guarded = { ...current, ast: forbidden, currentSemantics: forbidden };
  const result = selectRustCheckedCall({ ...request, source: { ...request.source } }, guarded, walk.operationOptions);
  assert.equal(result === completed.selection, true, "recreated requests return the same completed selection");
  assert.equal(result.value.selectedSignature === context.records.selectedCall.get(call), true);
  if (result.value.operation !== undefined) assert.equal(result.value.operation === context.records.selectedOperation.get(call), true);
  if (result.value.targetFact !== undefined) assert.equal(result.value.targetFact === context.records.targetOperation.get(call), true);
  if (name === "signature only") {
    assert.equal(Object.hasOwn(result.value, "operation"), false, "an omitted operation stays omitted");
    assert.equal(Object.hasOwn(result.value, "targetFact"), false, "later realization is not another checked-call component");
  }
  for (const [family, counts] of Object.entries(admissions)) assert.deepEqual([...counts], before[family], family);
  assert.equal(admissions.call.get(call), 1, "exactly one selected signature construction");
  for (const argument of request.source.sourceArguments) {
    assert.equal(admissions.argument.get(argument.expression), 1, "one native passing decision per source argument");
  }
  for (const changed of [
    { ...request, sourceSelectedDeclaration: {} },
    { ...request, source: { ...request.source, selectedSignature: {} } },
    { ...request, source: { ...request.source, optionalChain: !request.source.optionalChain } },
  ]) assert.throws(() => selectRustCheckedCall(changed, guarded, walk.operationOptions), /Conflicting Rust semantic plan/u);
  assert.throws(() => selectRustCheckedCall(request, guarded, { ...walk.operationOptions }), /Conflicting Rust semantic plan/u);
  assert.equal(walk.operationAttempts.get(call) === completed, true);
  const probe = createRustCarrierProbe(walk);
  assert.equal(probe.operationAttempts.has(call), false, "probes never inherit successful attempt state");
  const inherited = selectRustCheckedCall(request, rustOperationContext(probe, call), probe.operationOptions);
  assert.equal(inherited.kind, "accept");
  assert.equal(inherited.value.selectedSignature === result.value.selectedSignature, true, "inherited complete proof stays canonical");
  assert.equal(context.records.selectedCall.get(call) === result.value.selectedSignature, true, "probe admission never replaces the parent");
  context.records.seal(context.requiredRecords);
  assert.throws(() => selectRustCheckedCall(forbidden, guarded, walk.operationOptions), /sealed/u);
});

test("operation admission checks all inherited components before publishing any new component", () => {
  const { context, walk, requestFor } = analyzeRustOperations("export function value(input: number): number { return Math.abs(input); }");
  const call = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  const request = requestFor(call);
  const completed = walk.operationAttempts.get(call);
  const original = completed.selection.value.operation;
  const probe = createRustCarrierProbe(walk);
  let targetAdmissions = 0;
  const records = { ...probe.context.records,
    targetOperation: { get: () => undefined },
    selectedOperation: { get: () => ({ ...original, targetOperation: "contradictory" }) },
    targetOperations: { ...probe.context.records.targetOperations,
      checked(subject, selection) { targetAdmissions++; return probe.context.records.targetOperations.checked(subject, selection); } },
  };
  const current = { ...rustOperationContext(probe, call), records };
  assert.throws(() => admitRustOperationSelection(call, completed.selection, current), /Conflicting Rust semantic plan 'selectedOperation'/u);
  assert.equal(targetAdmissions, 0, "a later contradictory component cannot leave an earlier partial publication");
  assert.equal(context.records.selectedCall.get(request.source.call) === completed.selection.value.selectedSignature, true);
});

test("prepared calls retain their complete contract and failure Boolean before successful reuse", () => {
  const { context, walk } = analyzeRustOperations("export function twice(values: number[]): number[] { return values.map(value => value * 2); }");
  const call = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  assert.equal(call !== undefined, true);
  const completed = walk.operationAttempts.get(call);
  assert.equal(completed?.kind, "checked-call");
  assert.equal(completed.prepared !== undefined, true);
  const { value, callbackEffects } = completed.prepared;
  const current = { ...rustOperationContext(walk, call), ast: forbidden, currentSemantics: forbidden };
  const result = finalizeRustPreparedCheckedCall(completed.request,
    { ...value, parameterCarriers: [...value.parameterCarriers], callback: { ...value.callback }, template: { ...value.template } },
    { invocationOwner: callbackEffects.invocationOwner,
      invocationEffects: { ...callbackEffects.invocationEffects, nativeErrors: [...callbackEffects.invocationEffects.nativeErrors] },
      implementationEffects: { ...callbackEffects.implementationEffects, nativeErrors: [...callbackEffects.implementationEffects.nativeErrors] } },
    current, walk.operationOptions);
  assert.equal(result === completed.selection, true);
  for (const changed of [{ ...value, sourceName: "different" }, { ...value, resultCarrier: { kind: "tuple", elements: [] } },
    { ...value, parameterCarriers: [] }, { ...value, template: { ...value.template, operationId: "different" } }]) {
    assert.throws(() => finalizeRustPreparedCheckedCall(completed.request, changed, callbackEffects, current, walk.operationOptions), /Conflicting Rust completed prepared call/u);
  }
  for (const domain of ["invocationEffects", "implementationEffects"]) {
    const changed = { ...callbackEffects, [domain]: { ...callbackEffects[domain], localErrors: !callbackEffects[domain].localErrors } };
    assert.throws(() => finalizeRustPreparedCheckedCall(completed.request, value, changed, current, walk.operationOptions), /Conflicting Rust completed prepared call/u);
  }
  assert.throws(() => finalizeRustPreparedCheckedCall(completed.request, value, true, current, walk.operationOptions),
    /complete invocation and implementation effect contract/u, "the removed Boolean API is rejected");
  assert.throws(() => finalizeRustPreparedCheckedCall(completed.request, value,
    { ...callbackEffects, invocationOwner: {} }, current, walk.operationOptions), /Conflicting Rust completed prepared call/u,
    "a matching carrier never authorizes a different original invocation owner");
  assert.equal(walk.operationAttempts.get(call) === completed, true);
});

test("prepared callback cache rejects equal fallibility with different exact native identities and carriers", () => {
  const { context, walk } = analyzeRustOperations(`
function wrap<Value>(value: Value): Promise<number> {
  return new Promise<number>(resolve => {
    [value].reduce((accumulator, actual) => {
      void actual;
      resolve(accumulator);
      return accumulator;
    }, 7);
  });
}
console.log(await wrap(Promise.resolve(5)));
`);
  const call = context.sourceStorage.nodes.find(node => walk.operationAttempts.get(node)?.prepared?.value.callback.shape === "reduce");
  assert.equal(call !== undefined, true, "the checked native callback call was prepared");
  const completed = walk.operationAttempts.get(call);
  const { value, callbackEffects } = completed.prepared;
  const current = { ...rustOperationContext(walk, call), ast: forbidden, currentSemantics: forbidden };
  for (const domain of ["invocationEffects", "implementationEffects"]) {
    const selected = callbackEffects[domain];
    assert.equal(selected.nativeErrors.length !== 0, true, `the real selected callback carries its ${domain} native error channel`);
    const original = selected.nativeErrors[0];
    for (const error of [
      { ...original, identity: `${original.identity}:contradictory` },
      { ...original, errorType: { kind: "tuple", elements: [] } },
    ]) {
      const changed = { ...callbackEffects, [domain]: { ...selected, nativeErrors: [error, ...selected.nativeErrors.slice(1)] } };
      assert.throws(() => finalizeRustPreparedCheckedCall(completed.request, value, changed, current, walk.operationOptions), /Conflicting Rust completed prepared call/u);
    }
  }
  assert.equal(walk.operationAttempts.get(call) === completed, true, "refused channel changes never replace the canonical attempt");
});

test("a deferred callback remains retryable until its actual prepared completion", () => {
  const { context, walk, requestFor } = analyzeRustOperations("export function twice(values: number[]): number[] { return values.map(value => value * 2); }");
  const call = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  const request = requestFor(call);
  const probe = createRustCarrierProbe(walk);
  const current = rustOperationContext(probe, call);
  for (let attempt = 0; attempt < 2; attempt++) {
    const selected = selectRustCheckedCall(request, current, probe.operationOptions);
    assert.equal(selected.kind, "accept");
    assert.equal(selected.value.kind, "deferred-callback");
    assert.equal(probe.operationAttempts.has(call), false, "an incomplete request is never marked successful");
  }
});
