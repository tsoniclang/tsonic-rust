import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustOptionTargetType, rustFutureTargetType } from "../../../dist/target-model/types/index.js";
import { finalizeValueConversion, finalizedConversionIsValid } from "../../../dist/analysis/facts/finalized-operation/conversions.js";

test("source absence to native void is an exact zero-cost unit conversion", () => {
  const source = rustAbsenceTargetType();
  const target = rustUnitTargetType();
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "native-representation", source, target });
  assert.equal(rustValueConversionContract({ kind: "semantic-conversion", id: "unit-from-absence" }), undefined);
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

test("optional injection preserves a non-Clone native value and exact result evidence", () => {
  const source = rustFutureTargetType(rustUnitTargetType());
  const target = rustOptionTargetType(source);
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "option-some", element: source });
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  assert.equal(finalized.fallible, false);
  assert.equal(finalizeValueConversion(conversion, rustUnitTargetType(), target), undefined);
  assert.equal(finalizeValueConversion(conversion, source, source), undefined);
  assert.equal(finalizedConversionIsValid({ ...finalized, targetCarrier: source }), false);
});
