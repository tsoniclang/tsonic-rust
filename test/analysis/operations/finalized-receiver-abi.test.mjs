import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType, rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustStringToBorrowedStrValueConversion } from "../../../dist/public/provider.js";
import { rustBorrowedStrTargetType } from "../../../dist/target-model/types/index.js";

const bool = { kind: "source-primitive", name: "bool" };
const integer = { kind: "source-primitive", name: "int32" };
const base = rustNamedTargetType("fixture.Base", "fixture::Base");
const project = { target: base, path: "fixture::as_base" };
const derived = rustNamedTargetType("fixture.Derived", "fixture::Derived", [], [], undefined, [project]);

test("free-call receiver conversion retains the exact native borrowed-str ABI and rejects mutations", () => {
  const string = rustStringTargetType();
  const borrowed = rustBorrowedStrTargetType();
  for (const form of ["free-call", "free-call-str-slice"]) {
    const selected = { operationKind: "method", form: { form, path: "fixture::read",
      receiverMode: "value", receiverConversion: rustStringToBorrowedStrValueConversion },
      sourceReceiverCarrier: string, sourceArgumentCarriers: [], resultCarrier: bool,
      isAsync: false, isFallible: false };
    const abi = finalizeRustProviderOperationAbi(selected);
    assert.equal(abi !== undefined, true, form);
    assert.equal(validateRustFinalizedOperationAbi(abi), true, form);
    const input = abi.targetArguments[0];
    assert.deepEqual(input.parameterCarrier, borrowed);
    assert.deepEqual(input.conversion.conversion, rustStringToBorrowedStrValueConversion);
    assert.deepEqual(input.sourceCarrier, string);
    assert.equal(input.mode, "value");
    for (const [label, mutation] of [
      ["wrong source", { sourceReceiverCarrier: integer }],
      ["malformed conversion", { form: { ...selected.form, receiverConversion: { kind: "guessed" } } }],
      ["unknown conversion key", { form: { ...selected.form, receiverConversion: {
        ...rustStringToBorrowedStrValueConversion, extra: true } } }],
      ["unknown form key", { form: { ...selected.form, extra: true } }],
    ]) assert.equal(finalizeRustProviderOperationAbi({ ...selected, ...mutation }) === undefined, true, label);
    for (const [label, mutation] of [
      ["forged source", { sourceCarrier: integer }],
      ["wrong reference domain", { parameterCarrier: { kind: "reference", referent: string, mutable: false } }],
      ["missing conversion", { conversion: { kind: "identity", sourceCarrier: string,
        targetCarrier: string, fallible: false } }],
      ["wrong effect", { conversion: { ...input.conversion, fallible: true } }],
    ]) assert.equal(validateRustFinalizedOperationAbi({ ...abi,
      targetArguments: [{ ...input, ...mutation }, ...abi.targetArguments.slice(1)] }), false, label);
  }
});

function options(form, sourceArgumentCarriers = []) {
  return { operationKind: "method", form, sourceReceiverCarrier: derived,
    declaredSourceReceiverCarrier: base, sourceArgumentCarriers, resultCarrier: bool,
    isAsync: false, isFallible: false };
}

test("provider receiver carriers finalize once through the exact declared native owner", () => {
  for (const [form, operationKind, arguments_] of [
    [{ form: "receiver-method", name: "read" }, "method", []],
    [{ form: "method", name: "read" }, "method", []],
    [{ form: "free-call", path: "fixture::read", receiverMode: "ref" }, "method", []],
    [{ form: "field", name: "ready" }, "property", []],
    [{ form: "index" }, "indexer", [integer]],
  ]) {
    const abi = finalizeRustProviderOperationAbi({ ...options(form, arguments_), operationKind });
    assert.equal(abi !== undefined, true, form.form);
    assert.equal(validateRustFinalizedOperationAbi(abi), true, form.form);
    assert.deepEqual(abi.sourceReceiver, { kind: "receiver", carrier: derived,
      declaredCarrier: base, disposition: "runtime" });
    const input = abi.targetReceiver.kind === "input" ? abi.targetReceiver.input : abi.targetArguments[0];
    assert.equal(input.conversion.kind, "semantic", form.form);
    assert.deepEqual(input.conversion.conversion, { kind: "native-upcast", source: derived, target: base, path: project.path });
    assert.equal(input.source.kind, "receiver", form.form);
  }
  const template = { kind: "provider-operation", operationId: "fixture.Base.read", operationKind: "method",
    target: { form: "receiver-method", name: "read" }, receiverCarrier: base, parameterCarriers: [],
    resultCarrier: bool, isAsync: false, isFallible: false, errorBoundary: "none" };
  const fact = finalizeProviderOperationFact(template, [], derived, emptyRustTypeDefinitions);
  assert.equal(fact !== undefined, true);
  assert.deepEqual(fact.abi.sourceReceiver.declaredCarrier, base);
  assert.equal(fact.abi.targetReceiver.input.conversion.conversion.path, project.path);
});

test("missing, ambiguous and forged receiver owner evidence rejects before planning", () => {
  const original = options({ form: "receiver-method", name: "read" });
  for (const [label, mutation] of [
    ["missing projection", { sourceReceiverCarrier: rustNamedTargetType("fixture.Other", "fixture::Other") }],
    ["ambiguous projection", { sourceReceiverCarrier: rustNamedTargetType("fixture.Derived", "fixture::Derived", [], [], undefined,
      [project, { ...project, path: "fixture::other_base" }]) }],
    ["missing receiver", { sourceReceiverCarrier: undefined }],
    ["malformed owner", { declaredSourceReceiverCarrier: {} }],
    ["wrong conversion source", { form: { ...original.form, receiverConversion: {
      kind: "native-upcast", source: derived, target: base, path: project.path } } }],
  ]) assert.equal(finalizeRustProviderOperationAbi({ ...original, ...mutation }) === undefined, true, label);
  const abi = finalizeRustProviderOperationAbi(original);
  assert.equal(abi !== undefined, true);
  const input = abi.targetReceiver.input;
  for (const [label, mutation] of [
    ["declared owner", { sourceReceiver: { ...abi.sourceReceiver, declaredCarrier: derived } }],
    ["missing owner", { sourceReceiver: { kind: "receiver", carrier: derived, disposition: "runtime" } }],
    ["forged projection", { targetReceiver: { kind: "input", input: { ...input, conversion: {
      ...input.conversion, conversion: { ...input.conversion.conversion, path: "fixture::forged" } } } } }],
    ["wrong result", { targetReceiver: { kind: "input", input: { ...input, conversion: {
      ...input.conversion, targetCarrier: derived } } } }],
  ]) assert.equal(validateRustFinalizedOperationAbi({ ...abi, ...mutation }), false, label);
});

test("declared receiver projection composes with its physical borrowed input without erasing either contract", () => {
  const string = rustStringTargetType();
  const source = rustNamedTargetType("fixture.Text", "fixture::Text", [], [], undefined,
    [{ target: string, path: "fixture::as_string" }]);
  const abi = finalizeRustProviderOperationAbi({ ...options({ form: "receiver-method", name: "len",
    receiverConversion: rustStringToBorrowedStrValueConversion }),
    sourceReceiverCarrier: source, declaredSourceReceiverCarrier: string });
  assert.equal(abi !== undefined, true);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  const input = abi.targetReceiver.input;
  const conversion = input.conversion;
  assert.equal(conversion.kind, "sequence");
  assert.equal(conversion.steps.length, 2);
  assert.equal(conversion.steps[0].conversion.path, "fixture::as_string");
  assert.deepEqual(conversion.steps[1].conversion, rustStringToBorrowedStrValueConversion);
  assert.deepEqual(conversion.sourceCarrier, source);
  assert.deepEqual(conversion.targetCarrier, conversion.steps[1].targetCarrier);
  for (const [label, mutated] of [
    ["reordered", { ...conversion, steps: [...conversion.steps].reverse() }],
    ["missing step", { ...conversion, steps: conversion.steps.slice(1) }],
    ["false effect", { ...conversion, fallible: true }],
    ["nested sequence", { ...conversion, steps: [conversion, conversion.steps[1]] }],
    ["wrong endpoint", { ...conversion, targetCarrier: string }],
  ]) assert.equal(validateRustFinalizedOperationAbi({ ...abi,
    targetReceiver: { kind: "input", input: { ...input, conversion: mutated } } }), false, label);
});
