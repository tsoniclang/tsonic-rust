import assert from "node:assert/strict";
import test from "node:test";
import { mergeRustErrorEffects, rustErrorEffectsAreFallible, rustErrorEffectsEqual,
  rustPureErrorEffects, rustLocalErrorEffects } from "../../../dist/analysis/facts/error-effects.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";

const integer = rustSourcePrimitiveTargetType("int64");
const shared = { kind: "parameter", identity: "error/borrow", name: "error" };
const implementation = { kind: "type-parameter", identity: "callback/implementation", name: "Callback" };
const associated = { kind: "associated-type", owner: implementation, name: "InvocationError",
  genericArguments: [{ kind: "lifetime", lifetime: shared }],
  trait: { kind: "trait-ref", id: "owner/protocol", path: "Protocol", genericArguments: [], associatedConstraints: [] } };
const effects = (...nativeErrors) => ({ localErrors: false, nativeErrors });

test("exact effect algebra preserves pure and local channels independently", () => {
  assert.equal(mergeRustErrorEffects([]) === rustPureErrorEffects, true);
  assert.equal(mergeRustErrorEffects([rustPureErrorEffects, rustLocalErrorEffects]) === rustLocalErrorEffects, true);
  assert.equal(rustErrorEffectsAreFallible(rustPureErrorEffects), false);
  assert.equal(rustErrorEffectsAreFallible(rustLocalErrorEffects), true);
});

test("exact error algebra retains distinct identities even for the same associated carrier", () => {
  const first = { identity: "input/left", errorType: associated };
  const second = { identity: "input/right", errorType: associated };
  const joined = mergeRustErrorEffects([effects(second, first), effects(first), rustLocalErrorEffects]);
  assert.equal(joined.localErrors, true);
  assert.deepEqual(joined.nativeErrors.map(source => source.identity), ["input/left", "input/right"]);
  assert.equal(joined.nativeErrors.every(source => source.errorType === associated), true);
  assert.equal(Object.isFrozen(joined) && Object.isFrozen(joined.nativeErrors) && joined.nativeErrors.every(Object.isFrozen), true);
  assert.equal(rustErrorEffectsEqual(joined, mergeRustErrorEffects([rustLocalErrorEffects, effects(first, second)])), true);
  assert.equal(rustErrorEffectsAreFallible(joined), true);
  assert.equal(Object.hasOwn(joined.nativeErrors[0].errorType, "requirements"), false,
    "an effect carries no invented Clone, Default, Error or static constraints");
});

test("exact effect algebra rejects conflicting or empty identities rather than merging carriers", () => {
  const source = { identity: "input/left", errorType: associated };
  assert.equal(mergeRustErrorEffects([effects(source), effects({ ...source, errorType: integer })]) === undefined, true);
  assert.equal(mergeRustErrorEffects([effects({ ...source, identity: "" })]) === undefined, true);
  assert.equal(mergeRustErrorEffects([effects({ ...source, errorType: { kind: "unknown" } })]) === undefined, true);
  assert.equal(rustErrorEffectsEqual(effects(source), effects({ ...source, identity: "input/right" })), false);
  assert.equal(rustErrorEffectsEqual(effects(source), effects({ ...source, errorType: integer })), false);
  const otherLifetime = { ...associated, genericArguments: [{ kind: "lifetime", lifetime: { ...shared, identity: "other/borrow" } }] };
  assert.equal(mergeRustErrorEffects([effects(source), effects({ ...source, errorType: otherLifetime })]) === undefined, true);
});
