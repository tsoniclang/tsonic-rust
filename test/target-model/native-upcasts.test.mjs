import assert from "node:assert/strict";
import test from "node:test";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../dist/target-model/types/carriers/native.js";
import { selectRustSourceValueConversion } from "../../dist/policy/conversions/selection.js";
import { rustValueConversionContract, substituteRustValueConversion } from "../../dist/target-model/conversions/contracts.js";
import { rustJsTypedArrayTargetType } from "../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../dist/analysis/facts/finalized-operation-abi.js";
import { rustUnitTargetType } from "../../dist/target-model/types/index.js";

const bytes = rustJsTypedArrayTargetType("Uint8Array");
const path = "acme::ByteView::as_bytes";
const view = rustNamedTargetType("acme.ByteView", "acme::ByteView", [], [], undefined, [{ target: bytes, path }]);

test("native upcasts use one exact immutable carrier relationship", () => {
  const conversion = selectRustSourceValueConversion(view, bytes);
  assert.equal(conversion?.kind, "native-upcast");
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "projection", lowering: "call", path,
    sourceMode: "ref", source: view, target: bytes, fallible: false,
  });
  assert.equal(selectRustSourceValueConversion(bytes, view), undefined);
  assert.equal(selectRustSourceValueConversion(
    rustNamedTargetType("acme.Other", "acme::ByteView"), bytes), undefined);
});

test("native upcast facts reject missing, mismatched and ambiguous projections", () => {
  const conversion = selectRustSourceValueConversion(view, bytes);
  assert.equal(rustValueConversionContract({ ...conversion, path: "acme::copy_bytes" }), undefined);
  assert.equal(rustValueConversionContract({ ...conversion, target: rustJsTypedArrayTargetType("Uint32Array") }), undefined);
  assert.equal(rustValueConversionContract({ ...conversion, source: rustNamedTargetType("acme.ByteView", "acme::ByteView") }), undefined);
  assert.equal(rustNamedTypeCarrierValue(rustNamedTargetType("acme.ByteView", "acme::ByteView", [], [], undefined, [
    { target: bytes, path }, { target: bytes, path: "acme::other_bytes" },
  ])), undefined);
  assert.equal(rustNamedTypeCarrierValue(rustNamedTargetType("acme.ByteView", "acme::ByteView", [], [], undefined, [
    { target: bytes, path: "acme::bytes()" },
  ])), undefined);
});

test("native upcast generic substitution retains the projection and exact target", () => {
  const parameter = { kind: "type-parameter", name: "Element" };
  const target = { kind: "array", element: parameter };
  const generic = rustNamedTargetType("acme.View", "acme::View", [{ kind: "type", type: parameter }], [], undefined, [{ target, path: "acme::as_view" }]);
  const selected = selectRustSourceValueConversion(generic, target);
  const concrete = { kind: "source-primitive", name: "uint8" };
  const substituted = substituteRustValueConversion(selected, new Map([["Element", concrete]]));
  assert.ok(rustValueConversionContract(substituted));
  assert.ok(rustTargetTypeRefEquals(substituted.target, { kind: "array", element: concrete }));
  assert.ok(rustTargetTypeRefEquals(rustNamedTypeCarrierValue(substituted.source).upcasts[0].target, substituted.target));
});

test("inherited method and setter ABIs retain exact receiver projections", () => {
  const conversion = selectRustSourceValueConversion(view, bytes);
  for (const operationKind of ["property", "index-set"]) {
    const number = { kind: "source-primitive", name: "float64" };
    const options = {
      operationKind,
      form: { form: "receiver-method", name: operationKind === "property" ? "byte_length" : "set_number", receiverConversion: conversion },
      sourceReceiverCarrier: view,
      sourceArgumentCarriers: operationKind === "property" ? [] : [number, number],
      resultCarrier: operationKind === "property" ? number : rustUnitTargetType(),
      isAsync: false, isFallible: false,
    };
    const abi = finalizeRustProviderOperationAbi(options);
    assert.ok(abi);
    assert.ok(validateRustFinalizedOperationAbi(abi));
    assert.equal(abi.targetReceiver.input.conversion.kind, "semantic");
    assert.ok(rustTargetTypeRefEquals(abi.targetReceiver.input.conversion.targetCarrier, bytes));
    assert.equal(finalizeRustProviderOperationAbi({ ...options, sourceReceiverCarrier: bytes }), undefined);
    assert.equal(finalizeRustProviderOperationAbi({ ...options, form: { ...options.form, receiverConversion: { ...conversion, path: "acme::wrong" } } }), undefined);
    const corrupted = structuredClone(abi);
    corrupted.targetReceiver.input.conversion.targetCarrier = view;
    assert.equal(validateRustFinalizedOperationAbi(corrupted), false);
  }
});
