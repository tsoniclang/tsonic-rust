import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract, rustValueConversionIdentity } from "../../../dist/target-model/conversions/contracts.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustOptionTargetType, rustFutureTargetType,
  rustJsPromiseTargetTypeWithLifetime, rustSourcePrimitiveTargetType, rustJsErrorTargetType,
} from "../../../dist/target-model/types/index.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
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
  assert.deepEqual(conversion, { kind: "option-some", source, element: source });
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  assert.equal(finalized.fallible, false);
  assert.equal(finalizeValueConversion(conversion, rustUnitTargetType(), target), undefined);
  assert.equal(finalizeValueConversion(conversion, source, source), undefined);
  assert.equal(finalizedConversionIsValid({ ...finalized, targetCarrier: source }), false);
});

test("optional injection reuses exact native representation without promise mapping", () => {
  const lifetime = { kind: "static" };
  const source = rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), lifetime);
  const element = rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), lifetime);
  const target = rustOptionTargetType(element);
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "option-some", source, element });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact", lowering: "option-some", sourceMode: "value", source, target, fallible: false,
  });
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  for (const malformed of [
    { kind: "option-some", element },
    { ...conversion, source: null },
    { ...conversion, source: rustJsPromiseTargetTypeWithLifetime(rustSourcePrimitiveTargetType("int32"), lifetime) },
    { ...conversion, source: rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), lifetime, rustJsErrorTargetType()) },
    { ...conversion, source: rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "placeholder" }) },
    { ...conversion, element: rustSourcePrimitiveTargetType("int32") },
  ]) {
    assert.equal(rustValueConversionContract(malformed), undefined);
    assert.equal(finalizeValueConversion(malformed, source, target), undefined);
    assert.equal(finalizedConversionIsValid({ ...finalized, conversion: malformed }), false);
  }
  assert.notEqual(rustValueConversionIdentity(conversion),
    rustValueConversionIdentity({ kind: "option-some", source: element, element }));
  assert.equal(selectRustSourceValueConversion(rustAbsenceTargetType(), rustOptionTargetType(rustUnitTargetType())), undefined);
  assert.equal(rustValueConversionContract({ kind: "option-some", source: rustAbsenceTargetType(), element: rustUnitTargetType() }), undefined);
});

test("optional injection substitutes actual and selected carriers together", () => {
  const parameter = { kind: "type-parameter", identity: "Fixture.Value", name: "Value" };
  const element = rustFutureTargetType(parameter);
  const converted = substituteRustValueConversion({ kind: "option-some", source: element, element },
    new Map([[parameter.identity, rustUnitTargetType()]]));
  const future = rustFutureTargetType(rustUnitTargetType());
  assert.deepEqual(converted, { kind: "option-some", source: future, element: future });
  assert.ok(Object.isFrozen(converted));
  assert.equal(rustValueConversionContract(converted).lowering, "option-some");
});
