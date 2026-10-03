import assert from "node:assert/strict";
import test from "node:test";
import { rustCopiedMethodReceiverIsPreserved } from "../../../dist/policy/ownership/copied-methods.js";
import { rustCallableTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType,
  rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";

const integer = rustSourcePrimitiveTargetType("int32");
const shape = (presence, value = integer) => rustStructuralObjectTargetType("/src/index.ts", [
  { sourceName: "read", type: presence === "optional" ? rustOptionTargetType(rustCallableTargetType([], integer))
    : rustCallableTargetType([], integer), method: true, presence, readonly: false },
  { sourceName: "value", type: value, presence: "required", readonly: false },
]);

test("copied methods preserve only an identical native receiver-bearing callable ABI", () => {
  for (const presence of ["required", "optional"]) {
    const source = shape(presence);
    assert.equal(rustCopiedMethodReceiverIsPreserved(source, 0, shape(presence), 0), true);
    assert.equal(rustCopiedMethodReceiverIsPreserved(source, 0, shape(presence, rustSourcePrimitiveTargetType("int64")), 0), false);
    assert.equal(rustCopiedMethodReceiverIsPreserved(source, 0, shape(presence === "optional" ? "required" : "optional"), 0), false);
    for (const index of [-1, 1, 2, 0.5, Infinity]) {
      assert.equal(rustCopiedMethodReceiverIsPreserved(source, index, source, 0), false);
      assert.equal(rustCopiedMethodReceiverIsPreserved(source, 0, source, index), false);
    }
  }
});
