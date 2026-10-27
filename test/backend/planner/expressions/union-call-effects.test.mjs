import assert from "node:assert/strict";
import test from "node:test";
import { sourceCallEffectsMatch } from "../../../../dist/analysis/callables/calls/source-calls.js";
import { rustJsPromiseTargetType } from "../../../../dist/target-model/types/carriers/promises.js";
import { int32Carrier } from "../../../helpers/rust-session.mjs";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

test("union invocation and awaiting effects are independently closed for every arm", () => {
  const synchronous = { kind: "source-call", target: { form: "union-method", variants: [{}, {}] }, resultCarrier: int32Carrier };
  const asynchronous = { ...synchronous, resultCarrier: rustJsPromiseTargetType(int32Carrier) };
  const syncEffects = { unionBranches: [
    { invocation: "infallible", awaiting: "not-applicable" }, { invocation: "fallible", awaiting: "not-applicable" },
  ], invocation: "fallible", awaiting: "not-applicable" };
  const asyncEffects = { unionBranches: [
    { invocation: "infallible", awaiting: "infallible" }, { invocation: "infallible", awaiting: "fallible" },
  ], invocation: "infallible", awaiting: "fallible" };
  assert.equal(sourceCallEffectsMatch(synchronous, syncEffects, emptyRustTypeDefinitions), true);
  assert.equal(sourceCallEffectsMatch(asynchronous, asyncEffects, emptyRustTypeDefinitions), true);
  const optional = { ...asynchronous, resultCarrier: rustSourceOptionalTargetType(asynchronous.resultCarrier) };
  assert.equal(sourceCallEffectsMatch(optional, asyncEffects, emptyRustTypeDefinitions), true);
  assert.equal(sourceCallEffectsMatch(optional, syncEffects, emptyRustTypeDefinitions), false);
  assert.equal(sourceCallEffectsMatch(asynchronous, {
    unionBranches: [{ invocation: "fallible", awaiting: "infallible" }, asyncEffects.unionBranches[1]],
    invocation: "fallible", awaiting: "fallible",
  }, emptyRustTypeDefinitions), true);
  for (const mutation of [
    undefined,
    { ...asyncEffects, unionBranches: ["fallible"] },
    { ...asyncEffects, unionBranches: ["fallible", "unknown"] },
    { ...asyncEffects, invocation: "fallible" },
    { ...asyncEffects, awaiting: "infallible" },
    { ...asyncEffects, awaiting: "not-applicable" },
  ]) assert.equal(sourceCallEffectsMatch(asynchronous, mutation, emptyRustTypeDefinitions), false);
  assert.equal(sourceCallEffectsMatch(synchronous, asyncEffects, emptyRustTypeDefinitions), false);
  assert.equal(sourceCallEffectsMatch(asynchronous, syncEffects, emptyRustTypeDefinitions), false);
});
