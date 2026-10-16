import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { rustJsArrayTargetType, rustJsPromiseTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const value = rustSourcePrimitiveTargetType("uint64");
const promise = rustJsPromiseTargetType(value);
const request = { ownerName: "PromiseConstructor", memberName: "resolve", operationKind: "call" };

test("resolved values require exact source type-argument correspondence", () => {
  const call = { ...request, argumentCarriers: [value], sourceResultCarrier: promise };
  assert.equal(selectJsSurfaceOperation(call), undefined);
  assert.equal(selectJsSurfaceOperation({ ...call, argumentMatchesSelectedTypeArgument: () => false }), undefined);
  const selected = selectJsSurfaceOperation({ ...call,
    argumentMatchesSelectedTypeArgument: (argumentIndex, typeIndex) => argumentIndex === 0 && typeIndex === 0 });
  assert.deepEqual(selected.fact.resultCarrier, rustJsPromiseTargetType(value));
  assert.deepEqual(selected.fact.target, {
    form: "associated-call", owner: selected.fact.resultCarrier, method: "resolved",
  });
  assert.deepEqual(selected.parameterCarriers, [value]);
  assert.deepEqual(selected.fact.returnedFuture, { awaiting: "infallible", errorBoundary: "none" });
});

test("existing promises keep their carrier, reject through the JS rejection protocol and refuse contradictory outputs", () => {
  const call = { ...request, argumentCarriers: [promise], sourceResultCarrier: promise };
  const selected = selectJsSurfaceOperation(call);
  assert.deepEqual(selected.fact.resultCarrier, promise);
  assert.equal(selected.fact.target.path, "std::convert::identity");
  assert.deepEqual(selected.fact.returnedFuture, { awaiting: "fallible", errorBoundary: "js-rejection" });
  assert.equal(selectJsSurfaceOperation({ ...call,
    authoredMethodTypeArgumentCarriers: [rustSourcePrimitiveTargetType("int64")] }), undefined);
});

test("a resolved borrowed payload keeps its own lifetime and the Promise gains none", () => {
  const lifetime = { kind: "parameter", identity: "scope/borrow", name: "scope" };
  const payload = { kind: "reference", referent: value, mutable: false, lifetime };
  const selected = selectJsSurfaceOperation({ ...request, argumentCarriers: [payload],
    sourceResultCarrier: rustJsPromiseTargetType(payload), argumentMatchesSelectedTypeArgument: () => true });
  assert.deepEqual(selected.fact.resultCarrier, rustJsPromiseTargetType(payload));
  assert.equal(selected.fact.resultCarrier.genericArguments.length, 1);
  assert.equal(selected.fact.resultCarrier.genericArguments[0].type.lifetime === lifetime, true);
});

test("Promise.all collects the exact native element output into one JS array promise", () => {
  const input = rustJsArrayTargetType(promise);
  const selected = selectJsSurfaceOperation({ ownerName: "PromiseConstructor", memberName: "all", operationKind: "call",
    argumentCarriers: [input], sourceResultCarrier: rustJsPromiseTargetType(rustJsArrayTargetType(value)),
    canRequireClone: () => true });
  assert.ok(selected, "Promise.all is a selected static Promise operation");
  assert.deepEqual(selected.fact.resultCarrier, rustJsPromiseTargetType(rustJsArrayTargetType(value)));
  assert.deepEqual(selected.fact.target, { form: "call", path: "js_abi::promise_all", argModes: ["ref"] });
  assert.deepEqual(selected.fact.returnedFuture, { awaiting: "fallible", errorBoundary: "js-rejection" });
  assert.deepEqual(selected.parameterCarriers, [input]);
  const signed = rustSourcePrimitiveTargetType("int64");
  assert.deepEqual(selectJsSurfaceOperation({ ownerName: "PromiseConstructor", memberName: "all", operationKind: "call",
    argumentCarriers: [rustJsArrayTargetType(rustJsPromiseTargetType(signed))],
    sourceResultCarrier: rustJsPromiseTargetType(rustJsArrayTargetType(signed)), canRequireClone: () => true })
    .fact.resultCarrier, rustJsPromiseTargetType(rustJsArrayTargetType(signed)), "the int64 payload stays exact");
});

test("Promise.reject admits a JsValue reason and produces the selected output Promise", () => {
  const selected = selectJsSurfaceOperation({ ownerName: "PromiseConstructor", memberName: "reject", operationKind: "call",
    argumentCarriers: [rustJsValueTargetType()], sourceResultCarrier: promise });
  assert.ok(selected, "Promise.reject is a selected static Promise operation");
  assert.deepEqual(selected.fact.resultCarrier, promise);
  assert.deepEqual(selected.fact.target, { form: "associated-call", owner: promise, method: "rejected" });
  assert.deepEqual(selected.parameterCarriers, [rustJsValueTargetType()]);
  assert.deepEqual(selected.fact.returnedFuture, { awaiting: "fallible", errorBoundary: "js-rejection" });
  assert.equal(selectJsSurfaceOperation({ ownerName: "PromiseConstructor", memberName: "reject", operationKind: "call",
    argumentCarriers: [rustJsValueTargetType()], sourceResultCarrier: value }), undefined,
  "a non-Promise selected result is refused");
});
