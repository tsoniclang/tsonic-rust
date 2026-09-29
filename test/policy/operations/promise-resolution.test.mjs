import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { rustJsPromiseTargetType, rustJsPromiseTargetTypeWithLifetime, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";

const value = rustSourcePrimitiveTargetType("uint64");
const promise = rustJsPromiseTargetType(value);
const request = { ownerName: "PromiseConstructor", memberName: "resolve", operationKind: "call" };

test("resolved values require exact source type-argument correspondence", () => {
  const call = { ...request, argumentCarriers: [value], sourceResultCarrier: promise };
  assert.equal(selectJsSurfaceOperation(call), undefined);
  assert.equal(selectJsSurfaceOperation({ ...call, argumentMatchesSelectedTypeArgument: () => false }), undefined);
  const selected = selectJsSurfaceOperation({ ...call,
    argumentMatchesSelectedTypeArgument: (argumentIndex, typeIndex) => argumentIndex === 0 && typeIndex === 0 });
  assert.deepEqual(selected.fact.resultCarrier, rustJsPromiseTargetTypeWithLifetime(value, rustStaticLifetime));
  assert.deepEqual(selected.parameterCarriers, [value]);
});

test("existing promises keep their carrier and reject contradictory explicit outputs", () => {
  const call = { ...request, argumentCarriers: [promise], sourceResultCarrier: promise };
  const selected = selectJsSurfaceOperation(call);
  assert.deepEqual(selected.fact.resultCarrier, promise);
  assert.equal(selected.fact.target.path, "std::convert::identity");
  assert.equal(selected.fact.returnedFuture.awaiting, "fallible");
  assert.equal(selectJsSurfaceOperation({ ...call,
    authoredMethodTypeArgumentCarriers: [rustSourcePrimitiveTargetType("int64")] }), undefined);
});

test("resolved storage uses exact payload lifetime identities instead of printable names", () => {
  const lifetime = { kind: "parameter", identity: "scope/borrow", name: "scope" };
  const payload = { kind: "type-parameter", identity: "scope/Payload", name: "Value" };
  const parameter = { kind: "type", declaration: {}, identity: payload.identity, targetName: "Value",
    sourceName: "Value", maybeSized: false, outlives: [lifetime] };
  const storageContract = { declaration: {}, parameters: [
    { ...parameter, identity: "other/Payload", outlives: [rustStaticLifetime] }, parameter,
    { kind: "lifetime", declaration: {}, sourceName: "scope", lifetime, outlives: [] },
  ] };
  const selected = selectJsSurfaceOperation({ ...request, argumentCarriers: [payload],
    sourceResultCarrier: rustJsPromiseTargetType(payload), storageContract,
    argumentMatchesSelectedTypeArgument: () => true });
  assert.deepEqual(selected.fact.resultCarrier, rustJsPromiseTargetTypeWithLifetime(payload, lifetime));
});
