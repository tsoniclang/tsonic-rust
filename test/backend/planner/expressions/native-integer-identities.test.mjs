import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeIntegerIdentity } from "../../../../dist/backend/planner/expressions/native-integer-identities.js";

test("signed native all-bits identities retain the exact converted operand", () => {
  const value = { kind: "call", path: "observe", args: [] };
  for (const name of ["int8", "int16", "int32", "int64", "native-int"]) {
    const carrier = { kind: "source-primitive", name };
    for (const mask of [{ kind: "int-literal", text: "-1" },
      { kind: "unary", operator: "-", operand: { kind: "int-literal", text: "1" } }]) {
      assert.equal(planRustNativeIntegerIdentity("&", value, mask, carrier), value);
      assert.equal(planRustNativeIntegerIdentity("&", mask, value, carrier), value);
    }
  }
  for (const carrier of [{ kind: "source-primitive", name: "uint32" },
    { kind: "source-primitive", name: "float64" }, { kind: "type-parameter", name: "Custom" }]) {
    assert.equal(planRustNativeIntegerIdentity("&", value, { kind: "int-literal", text: "-1" }, carrier), undefined);
  }
  const signed = { kind: "source-primitive", name: "int32" };
  assert.equal(planRustNativeIntegerIdentity("|", value, { kind: "int-literal", text: "-1" }, signed), undefined);
  assert.equal(planRustNativeIntegerIdentity("&", value, { kind: "int-literal", text: "-2" }, signed), undefined);
  assert.equal(planRustNativeIntegerIdentity("&", value, { kind: "call", path: "mask", args: [] }, signed), undefined);
});
