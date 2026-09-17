import assert from "node:assert/strict";
import test from "node:test";
import { selectRustBinaryOperator } from "../../../dist/policy/operations/operator-rules.js";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("array membership admits only exact numeric key carriers and retains operand order", () => {
  const array = rustJsArrayTargetType({ kind: "type-parameter", name: "T" });
  for (const kind of ["float64", "float32", "int8", "uint8", "int16", "uint16", "int32", "uint32"]) {
    const selection = selectRustBinaryOperator("in", rustSourcePrimitiveTargetType(kind), array);
    assert.equal(selection?.kind, "operator-call");
    assert.equal(selection.path, "js_abi::JsArray::contains_number_property");
    assert.deepEqual(selection.operandModes, ["value", "ref"]);
    assert.equal(selection.fallible, false);
    assert.equal(selection.leftConversion?.target, kind === "float64" ? undefined : "float64");
  }
  for (const kind of ["int64", "uint64", "int128", "uint128", "native-int", "native-uint", "bool"]) {
    assert.equal(selectRustBinaryOperator("in", rustSourcePrimitiveTargetType(kind), array), undefined);
  }
  assert.equal(selectRustBinaryOperator("in", rustStringTargetType(), array), undefined);
  assert.equal(selectRustBinaryOperator("in", rustSourcePrimitiveTargetType("float64"), rustStringTargetType()), undefined);
});
