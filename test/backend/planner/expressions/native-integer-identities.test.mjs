import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeIntegerIdentity } from "../../../../dist/backend/planner/expressions/native-integer-identities.js";

// The identity decision is analysis-owned (test/analysis/expressions/native-integer-identities.test.mjs); the planner
// returns the operand the sealed record selects and nothing otherwise.
function context(selected) {
  return { input: { program: { records: { nativeComparison: { get: node => node === expression ? selected : undefined } } } } };
}
const expression = {};

test("signed native all-bits identities retain the exact converted operand", () => {
  const value = { kind: "call", path: "observe", args: [] };
  const mask = { kind: "int-literal", text: "-1" };
  assert.equal(planRustNativeIntegerIdentity(expression, value, mask, context({ kind: "integer-identity", operand: "left" })), value);
  assert.equal(planRustNativeIntegerIdentity(expression, mask, value, context({ kind: "integer-identity", operand: "right" })), value);
  assert.equal(planRustNativeIntegerIdentity(expression, value, mask, context({ kind: "ordinary" })), undefined);
  assert.equal(planRustNativeIntegerIdentity(expression, value, mask, context(undefined)), undefined);
});
