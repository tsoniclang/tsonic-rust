import assert from "node:assert/strict";
import test from "node:test";
import { sourceCallEffectsMatch } from "../../../../dist/backend/planner/expressions/calls/source.js";
import { rustJsPromiseTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { int32Carrier } from "../../../helpers/rust-session.mjs";

test("union invocation and awaiting effects are independently closed for every arm", () => {
  const synchronous = { kind: "source-call", target: { form: "union-method", variants: [{}, {}] }, resultCarrier: int32Carrier };
  const asynchronous = { ...synchronous, resultCarrier: rustJsPromiseTargetType(int32Carrier) };
  const syncEffects = { unionBranches: ["infallible", "fallible"], invocation: "fallible", awaiting: "not-applicable" };
  const asyncEffects = { unionBranches: ["infallible", "fallible"], invocation: "infallible", awaiting: "fallible" };
  assert.equal(sourceCallEffectsMatch(synchronous, syncEffects), true);
  assert.equal(sourceCallEffectsMatch(asynchronous, asyncEffects), true);
  for (const mutation of [
    undefined,
    { ...asyncEffects, unionBranches: ["fallible"] },
    { ...asyncEffects, unionBranches: ["fallible", "unknown"] },
    { ...asyncEffects, invocation: "fallible" },
    { ...asyncEffects, awaiting: "infallible" },
    { ...asyncEffects, awaiting: "not-applicable" },
  ]) assert.equal(sourceCallEffectsMatch(asynchronous, mutation), false);
  assert.equal(sourceCallEffectsMatch(synchronous, asyncEffects), false);
  assert.equal(sourceCallEffectsMatch(asynchronous, syncEffects), false);
});
