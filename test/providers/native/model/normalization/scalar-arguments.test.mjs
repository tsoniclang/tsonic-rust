import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConstArgument, normalizeLifetime } from "../../../../../dist/providers/native/model/normalization/scalar-arguments.js";

const lifetime = Object.freeze({ kind: "parameter", ownerIdentity: "owner", name: "source" });
const identity = Object.freeze({ ownerIdentity: "owner", name: "Count" });
const context = { owner: { itemId: "owner" }, parameters: new Map([
  ["source", { kind: "lifetime", lifetime }],
  ["Count", { kind: "const", identity, name: "Count" }],
]) };

test("scalar argument normalization preserves exact native integers and declaration identities", () => {
  const wide = "340282366920938463463374607431768211455";
  assert.equal(normalizeConstArgument(`${wide}u128`, context, "wide").value, wide);
  assert.equal(normalizeConstArgument("-0x80_i128", context, "negative").value, "-128");
  assert.equal(normalizeConstArgument(true, context, "boolean").value, true);
  assert.equal(normalizeConstArgument("false", context, "boolean").value, false);
  assert.equal(normalizeConstArgument("_", context, "inference").kind, "infer");
  const selected = normalizeConstArgument("Count", context, "parameter");
  assert.equal(selected.identity === identity, true, "const argument retains its exact declared identity");
  assert.equal(Object.isFrozen(selected), true, "normalized const data is immutable");
});

test("lifetime and character normalization preserves native scalar values", () => {
  assert.equal(normalizeLifetime("'source", context, "input") === lifetime, true, "authored lifetime retains declaration identity");
  assert.equal(normalizeLifetime("'static", context, "input").kind, "static");
  assert.equal(normalizeLifetime("'_", context, "input").kind, "placeholder");
  assert.equal(normalizeLifetime(undefined, context, "input").position, "input");
  assert.equal(normalizeConstArgument(String.raw`'\u{1f642}'`, context, "character").value, "🙂");
  assert.equal(normalizeConstArgument(String.raw`'\n'`, context, "character").value, "\n");
});

test("unproven metadata and imprecise host numbers are refused without limiting exact native tokens", () => {
  assert.throws(() => normalizeLifetime("'missing", context, "input"), /declaration-backed identity/u);
  assert.throws(() => normalizeLifetime(1, context, "input"), /stable rustdoc representation/u);
  assert.throws(() => normalizeConstArgument(Number.MAX_SAFE_INTEGER + 1, context, "host"), /not a safe integer/u);
  assert.equal(normalizeConstArgument("9007199254740993", context, "exact").value, "9007199254740993");
  assert.throws(() => normalizeConstArgument("Missing", context, "parameter"), /declaration-backed identity/u);
  assert.throws(() => normalizeConstArgument("1 + 2", context, "expression"), /outside the approved literal-or-parameter contract/u);
  assert.throws(() => normalizeConstArgument(String.raw`'\u{d800}'`, context, "character"), /invalid Unicode scalar value/u);
  assert.throws(() => normalizeConstArgument({}, context, "metadata"), /no exact scalar representation/u);
});
