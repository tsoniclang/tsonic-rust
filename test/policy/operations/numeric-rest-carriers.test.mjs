import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNumericRestCarrier } from "../../../dist/policy/operations/js-surface/numeric-rest.js";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const numeric = rustSourcePrimitiveTargetType;

test("numeric rest arguments retain every homogeneous native carrier", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
    "int128", "uint128", "native-int", "native-uint", "float32", "float64"]) {
    const carrier = numeric(name);
    assert.deepEqual(selectRustNumericRestCarrier([carrier, carrier], []), carrier);
    assert.deepEqual(selectRustNumericRestCarrier([rustJsArrayTargetType(carrier)], [0]), carrier);
    assert.deepEqual(selectRustNumericRestCarrier([{ kind: "array", element: carrier }], [0]), carrier);
  }
  assert.deepEqual(selectRustNumericRestCarrier([], []), numeric("float64"));
  assert.deepEqual(selectRustNumericRestCarrier([{ kind: "tuple", elements: [] }], [0]), numeric("float64"));
});

test("numeric rest widening is exact and never rounds wide integer operands", () => {
  for (const [left, right, result] of [
    ["int32", "uint32", "int64"], ["uint8", "uint32", "uint32"],
    ["uint64", "int64", "int128"], ["float64", "uint32", "float64"],
    ["float32", "int16", "float32"], ["float32", "uint32", "float64"],
  ]) {
    for (const names of [[left, right], [right, left]]) {
      assert.deepEqual(selectRustNumericRestCarrier(names.map(numeric), []), numeric(result));
      assert.deepEqual(selectRustNumericRestCarrier([{ kind: "tuple", elements: names.map(numeric) }], [0]), numeric(result));
    }
  }
  for (const integer of ["int64", "uint64", "int128", "uint128", "native-int", "native-uint"]) {
    for (const floating of ["float32", "float64"]) {
      assert.equal(selectRustNumericRestCarrier([numeric(integer), numeric(floating)], []), undefined);
    }
  }
  assert.equal(selectRustNumericRestCarrier([numeric("int128"), numeric("uint128")], []), undefined);
  assert.equal(selectRustNumericRestCarrier([undefined], []), undefined);
  assert.equal(selectRustNumericRestCarrier([{ kind: "string" }], []), undefined);
  assert.equal(selectRustNumericRestCarrier([numeric("uint32")], [0]), undefined);
});
