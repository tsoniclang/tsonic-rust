import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract, rustValueConversionIdentity } from "../../../dist/target-model/conversions/contracts.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustOptionTargetType, rustFutureTargetType,
  rustJsPromiseTargetTypeWithLifetime, rustSourcePrimitiveTargetType, rustJsErrorTargetType,
  rustJsValueTargetType, rustJsArrayTargetType, rustStringTargetType,
  rustStrTargetType,
} from "../../../dist/target-model/types/index.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { finalizeValueConversion, finalizedConversionIsValid } from "../../../dist/analysis/facts/finalized-operation/conversions.js";
import { lowerRustValueConversion } from "../../../dist/backend/planner/expressions/value-conversions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("closed native array injection retains its exact payload and rejects forged carriers", () => {
  const source = rustJsArrayTargetType(rustJsValueTargetType());
  const target = rustJsValueTargetType();
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "js-value-from-array", source, element: rustJsValueTargetType(),
    elementConversion: { kind: "semantic-conversion", id: "js-value-clone" } });
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  assert.equal(finalized.fallible, false);
  for (const malformed of [
    { ...conversion, element: rustJsErrorTargetType() },
    { ...conversion, source: rustJsArrayTargetType(rustStringTargetType()) },
    { ...conversion, target: rustJsErrorTargetType() },
    { ...conversion, guessed: true },
  ]) {
    assert.equal(rustValueConversionContract(malformed), undefined);
    assert.equal(finalizedConversionIsValid({ ...finalized, conversion: malformed }), false);
  }
});

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
  assert.deepEqual(conversion, { kind: "option-some", source, element: source, elementConversion: null });
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
  assert.deepEqual(conversion, { kind: "option-some", source, element, elementConversion: null });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact", lowering: "option-some", sourceMode: "value", source, target, element: null, fallible: false,
  });
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  for (const malformed of [
    { kind: "option-some", element },
    { kind: "option-some", source, element },
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
    rustValueConversionIdentity({ kind: "option-some", source: element, element, elementConversion: null }));
  assert.equal(selectRustSourceValueConversion(rustAbsenceTargetType(), rustOptionTargetType(rustUnitTargetType())), undefined);
  assert.equal(rustValueConversionContract({ kind: "option-some", source: rustAbsenceTargetType(), element: rustUnitTargetType(), elementConversion: null }), undefined);
});

test("optional injection substitutes actual and selected carriers together", () => {
  const parameter = { kind: "type-parameter", identity: "Fixture.Value", name: "Value" };
  const element = rustFutureTargetType(parameter);
  const converted = substituteRustValueConversion({ kind: "option-some", source: element, element, elementConversion: null },
    new Map([[parameter.identity, rustUnitTargetType()]]));
  const future = rustFutureTargetType(rustUnitTargetType());
  assert.deepEqual(converted, { kind: "option-some", source: future, element: future, elementConversion: null });
  assert.ok(Object.isFrozen(converted));
  assert.equal(rustValueConversionContract(converted).lowering, "option-some");
});

test("optional injection validates and substitutes its exact selected payload conversion", () => {
  const source = rustSourcePrimitiveTargetType("int32");
  const element = rustSourcePrimitiveTargetType("int64");
  const target = rustOptionTargetType(element);
  const conversion = selectRustSourceValueConversion(source, target);
  assert.equal(conversion.kind, "option-some");
  assert.equal(conversion.elementConversion !== null, true);
  const contract = rustValueConversionContract(conversion);
  assert.equal(contract.lowering, "option-some");
  assert.deepEqual(contract.element.source, source);
  assert.deepEqual(contract.element.target, element);
  assert.equal(contract.fallible, false);
  const finalized = finalizeValueConversion(conversion, source, target);
  assert.equal(finalizedConversionIsValid(finalized), true);
  assert.deepEqual(substituteRustValueConversion(conversion, new Map()), conversion);
  for (const malformed of [
    { ...conversion, elementConversion: null },
    { ...conversion, elementConversion: undefined },
    { ...conversion, elementConversion: { ...conversion.elementConversion, source: "uint64" } },
    { ...conversion, elementConversion: { ...conversion.elementConversion, target: "int32" } },
    { ...conversion, elementConversion: { ...conversion.elementConversion, guessed: true } },
    { ...conversion, element: source },
    { ...conversion, guessed: true },
  ]) {
    assert.equal(rustValueConversionContract(malformed) === undefined, true, "malformed payload conversion rejects");
    assert.equal(finalizedConversionIsValid({ ...finalized, conversion: malformed }), false);
  }
  assert.notEqual(rustValueConversionIdentity(conversion), rustValueConversionIdentity({ ...conversion, elementConversion: null }));
});

test("optional payload lowering preserves borrowing and propagates native conversion failure before injection", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) },
    configuration: { edition: "2024" } } }, sourceFile, diagnostics: [], usedAliases: new Set() };
  const value = { kind: "path", path: "value" };
  const borrowedElement = { kind: "reference", referent: rustStrTargetType(), mutable: false };
  assert.equal(selectRustSourceValueConversion(rustStringTargetType(), rustOptionTargetType(borrowedElement)), undefined,
    "implicit optional borrowing cannot invent an escaping lifetime");
  const borrowed = { kind: "option-some", source: rustStringTargetType(), element: borrowedElement,
    elementConversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" } };
  const borrowedContract = rustValueConversionContract(borrowed);
  assert.equal(borrowedContract.element.sourceMode, "ref");
  const borrowedValue = lowerRustValueConversion(borrowedContract, value, context, node);
  assert.deepEqual(borrowedValue, { kind: "call", path: "Some", args: [{ kind: "method-call", receiver: value, method: "as_str", args: [] }] });
  const source = rustSourcePrimitiveTargetType("uint64");
  const element = rustSourcePrimitiveTargetType("int64");
  assert.equal(selectRustSourceValueConversion(source, rustOptionTargetType(element)), undefined,
    "implicit optional injection does not invent an integer narrowing");
  const conversion = { kind: "option-some", source, element,
    elementConversion: { kind: "exact-integer", source, target: element } };
  const contract = rustValueConversionContract(conversion);
  assert.equal(contract.fallible, true);
  assert.equal(finalizedConversionIsValid(finalizeValueConversion(conversion, source, rustOptionTargetType(element))), true);
  const converted = lowerRustValueConversion(contract, value, context, node);
  assert.equal(converted.kind, "method-call");
  assert.equal(converted.method, "map");
  assert.deepEqual(converted.args, [{ kind: "path", path: "Some" }]);
  assert.equal(context.diagnostics.length, 0);
});
