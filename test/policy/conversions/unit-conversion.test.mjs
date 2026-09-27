import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";

test("source absence to native void is an exact zero-cost unit conversion", () => {
  const source = rustAbsenceTargetType();
  const target = rustUnitTargetType();
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "semantic-conversion", id: "unit-from-absence" });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact", lowering: "identity", sourceMode: "value", source, target, fallible: false,
  });
  for (const value of [
    { kind: "source-primitive", name: "int32" },
    { kind: "source-primitive", name: "bool" },
    { kind: "tuple", elements: [{ kind: "source-primitive", name: "int32" }] },
    rustOptionTargetType({ kind: "source-primitive", name: "int32" }),
  ]) assert.equal(selectRustSourceValueConversion(value, target), undefined);
});
