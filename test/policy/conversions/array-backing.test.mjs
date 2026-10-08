import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustContextualRuntimeConversionContract } from "../../../dist/target-model/conversions/contextual.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { rustJsArrayTargetType, rustJsArrayValueTargetType, rustJsValueTargetType, rustJsErrorTargetType, rustOptionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

const broad = rustJsValueTargetType();
const category = rustJsArrayValueTargetType();
const string = rustStringTargetType();
const integer = { kind: "source-primitive", name: "uint64" };

test("native array recovery selects only the exact backing owner and checked effects", () => {
  for (const source of [broad, category]) for (const element of [broad, string, integer]) {
    const target = rustJsArrayTargetType(element);
    const conversion = selectRustSourceValueConversion(source, target);
    assert.deepEqual(conversion, { kind: "js-array-backing", source, element });
    const contract = rustValueConversionContract(conversion);
    assert.deepEqual(contract, {
      category: "projection", lowering: "js-array-backing", sourceMode: "ref", source, target,
      fallible: true, errorBoundary: "provider-native", errorCarrier: rustJsErrorTargetType(),
      element, method: source === broad ? "cast_array" : "cast",
    });
    assert.deepEqual(rustContextualRuntimeConversionContract(conversion), contract);
    for (const changed of [
      { ...conversion, source: string },
      { ...conversion, source: { ...source, genericArguments: [{ kind: "type", type: string }] } },
      { ...conversion, element: { kind: "source-primitive", name: "invalid" } },
      { ...conversion, layout: "inferred" },
      { ...conversion, target },
    ]) assert.equal(rustValueConversionContract(changed), undefined);
  }
  assert.equal(selectRustSourceValueConversion(string, rustJsArrayTargetType(string)), undefined);
});

test("optional conversions retain their exact native failure boundary", () => {
  for (const source of [broad, category]) {
    const target = rustJsArrayTargetType(string);
    const conversion = selectRustSourceValueConversion(source, target);
    for (const outer of [
      { kind: "option-some", source, element: target, elementConversion: conversion },
      { kind: "option-map", elementConversion: conversion },
    ]) {
      const contract = rustValueConversionContract(outer);
      assert.equal(contract.fallible, true);
      assert.equal(contract.errorBoundary, "provider-native");
      assert.deepEqual(contract.errorCarrier, rustJsErrorTargetType());
      assert.deepEqual(contract.target, rustOptionTargetType(target));
      assert.equal(contract.element.fallible, true);
      assert.equal(rustValueConversionContract({ ...outer, elementConversion: { ...conversion, errorCarrier: integer } }), undefined);
    }
  }
  const integerConversion = { kind: "exact-integer", source: { kind: "source-primitive", name: "float64" }, target: integer };
  const runtime = rustValueConversionContract(integerConversion);
  const optionalRuntime = rustValueConversionContract({ kind: "option-map", elementConversion: integerConversion });
  for (const contract of [runtime, optionalRuntime]) {
    assert.equal(contract.fallible, true);
    assert.equal(contract.errorBoundary, "target-runtime");
    assert.equal(contract.errorCarrier, undefined);
  }
});

test("array admission retains one static projection instead of materializing native elements", () => {
  for (const [element, projection] of [[string, "string"], [broad, "value"], [integer, "owned"]]) {
    const conversion = selectRustSourceValueConversion(rustJsArrayTargetType(element), broad);
    const contract = rustValueConversionContract(conversion);
    assert.equal(contract.lowering, "js-value-from-array");
    assert.equal(contract.projection, projection);
    assert.equal(contract.sourceMode, "ref");
    assert.equal(contract.fallible, false);
    assert.equal(rustValueConversionContract({ ...conversion, projection: "owned" }), undefined);
    assert.equal(rustValueConversionContract({ ...conversion, element: element === string ? integer : string }), undefined);
    const wrongConversion = selectRustSourceValueConversion(element === string ? integer : string, broad);
    assert.equal(rustValueConversionContract({ ...conversion, elementConversion: wrongConversion }), undefined);
  }
});

test("native array backing evidence cannot erase free types or borrowed lifetimes", () => {
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const referent = { kind: "source-primitive", name: "uint64" };
  for (const element of [parameter,
    { kind: "reference", referent, mutable: false },
    { kind: "reference", referent, mutable: false, lifetime: { kind: "parameter", identity: "scope", name: "scope" } },
    { kind: "reference", referent, mutable: false, lifetime: { kind: "call-scoped-elision", callIdentity: "call", parameterIdentity: "input" } },
  ]) {
    assert.equal(selectRustSourceValueConversion(broad, rustJsArrayTargetType(element)), undefined);
    assert.equal(selectRustSourceValueConversion(rustJsArrayTargetType(element), broad), undefined);
    assert.equal(rustValueConversionContract({ kind: "js-array-backing", source: broad, element }), undefined);
  }
  const unsubstituted = { kind: "js-array-backing", source: category, element: parameter };
  const substituted = substituteRustValueConversion(unsubstituted, new Map([[parameter.identity, integer]]));
  assert.deepEqual(substituted, { kind: "js-array-backing", source: category, element: integer });
  assert.equal(Object.isFrozen(substituted), true);
  assert.equal(rustValueConversionContract(substituted).target.genericArguments[0].type, integer);
});

test("finalized array recovery rejects contradictory physical input, target and effects", () => {
  const conversion = selectRustSourceValueConversion(broad, rustJsArrayTargetType(string));
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "consume", argConversions: [conversion] },
    sourceArgumentCarriers: [broad], resultCarrier: { kind: "tuple", elements: [] },
    isAsync: false, isFallible: false,
  });
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  for (const mutate of [
    value => { value.targetArguments[0].conversion.fallible = false; },
    value => { value.targetArguments[0].conversion.targetCarrier = rustJsArrayTargetType(integer); },
    value => { value.targetArguments[0].conversion.conversion.element = integer; },
    value => { value.targetArguments[0].sourceCarrier = string; },
  ]) {
    const changed = structuredClone(abi);
    mutate(changed);
    assert.equal(validateRustFinalizedOperationAbi(changed), false);
  }
});
