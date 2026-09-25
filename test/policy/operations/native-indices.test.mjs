import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeIndex } from "../../../dist/policy/operations/native-indices.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("native indexing keeps usize and checked native integer widths without float intermediates", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "native-int", "native-uint"]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const selected = selectRustNativeIndex(carrier);
    assert.deepEqual(selected?.carrier, carrier);
    if (name === "native-uint") assert.equal(selected.conversion, undefined);
    else assert.deepEqual(selected.conversion, {
      kind: "exact-integer", source: carrier, target: rustSourcePrimitiveTargetType("native-uint"),
    });
  }
  for (const carrier of [undefined, rustSourcePrimitiveTargetType("float64"), rustSourcePrimitiveTargetType("bool"),
    { kind: "type-parameter", name: "T" }]) {
    assert.equal(selectRustNativeIndex(carrier), undefined);
  }
});
