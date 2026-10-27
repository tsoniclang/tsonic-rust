import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import { validateRustFinalizedOperationAbi } from "../../../dist/policy/operations/members/abi/validation.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/program/records/native/provider-operations.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType, rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustStringToBorrowedStrValueConversion } from "../../../dist/public/provider.js";
import { rustBorrowedStrTargetType } from "../../../dist/target-model/types/index.js";
import { compileRust } from "../../helpers/rust-session.mjs";

const bool = { kind: "source-primitive", name: "bool" };
const integer = { kind: "source-primitive", name: "int32" };
const base = rustNamedTargetType("fixture.Base", "fixture::Base");
const project = { target: base, path: "fixture::as_base" };
const derived = rustNamedTargetType("fixture.Derived", "fixture::Derived", [], [], undefined, [project]);

test("selected JavaScript API roots remain compile-time qualifiers without native receiver values", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function reported(): void {
  console.log(Math.abs(-2), globalThis.Math.abs(-3));
}
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 2048));
  const program = result.program;
  assert.equal(program !== undefined, true, "the checked native program is published");
  let qualifiers = 0;
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "provider-operation" && operation.abi.sourceReceiver.kind === "compile-time") qualifiers += 1;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(qualifiers, 3, "console and both selected Math qualifiers carry no runtime receiver");
});

test("receiver evaluation and target consumption are independent closed ABI decisions", () => {
  const options = { operationKind: "method", form: { form: "call", path: "fixture::read" },
    sourceReceiver: { kind: "runtime", carrier: derived }, sourceArgumentCarriers: [],
    resultCarrier: bool, isAsync: false, isFallible: false };
  const abi = finalizeRustProviderOperationAbi(options);
  assert.equal(abi !== undefined, true, "a target-unused runtime receiver is admitted");
  assert.deepEqual(abi.sourceReceiver, { kind: "receiver", carrier: derived,
    declaredCarrier: derived, disposition: "evaluation-only" });
  assert.deepEqual(abi.targetReceiver, { kind: "none" });
  assert.equal(abi.targetArguments.length, 0, "no fabricated receiver argument");
  assert.equal(Object.isFrozen(abi.sourceReceiver), true, "published receiver evidence is immutable");
  for (const [label, sourceReceiver] of [
    ["consumed disposition without a target use", { ...abi.sourceReceiver, disposition: "runtime" }],
    ["old compile-time receiver shape", { ...abi.sourceReceiver, disposition: "compile-time" }],
    ["unknown disposition", { ...abi.sourceReceiver, disposition: "discard-if-pure" }],
    ["missing carrier", { kind: "receiver", disposition: "evaluation-only" }],
  ]) assert.equal(validateRustFinalizedOperationAbi({ ...abi, sourceReceiver }), false, label);
  const qualifier = finalizeRustProviderOperationAbi({ ...options, sourceReceiver: { kind: "compile-time" } });
  assert.equal(qualifier !== undefined, true, "a checked qualifier needs no runtime carrier");
  assert.deepEqual(qualifier.sourceReceiver, { kind: "compile-time" });
  assert.equal(finalizeRustProviderOperationAbi({ ...options, sourceReceiver: { kind: "compile-time" },
    form: { form: "receiver-method", name: "read" } }) === undefined, true, "a qualifier cannot supply a native receiver value");
  for (const [label, sourceReceiver] of [
    ["bare carrier", derived], ["missing carrier", { kind: "runtime" }],
    ["unknown receiver kind", { kind: "guessed", carrier: derived }],
    ["qualifier with a runtime payload", { kind: "compile-time", carrier: derived }],
    ["runtime with extra fields", { kind: "runtime", carrier: derived, extra: true }],
  ]) assert.equal(finalizeRustProviderOperationAbi({ ...options, sourceReceiver }) === undefined, true, label);
  assert.equal(finalizeRustProviderOperationAbi({ ...options, sourceReceiver: undefined,
    sourceReceiverCarrier: derived }) === undefined, true, "the removed carrier-only input is rejected");
  const template = { kind: "provider-operation", operationId: "fixture.read", operationKind: "method",
    target: options.form, parameterCarriers: [], resultCarrier: bool, isAsync: false, isFallible: false,
    errorBoundary: "none" };
  assert.equal(finalizeProviderOperationFact(template, [], derived, emptyRustTypeDefinitions) === undefined,
    true, "the removed carrier-only fact finalizer signature is rejected");
});

test("native namespace calls and associated values preserve explicit inputs without a runtime namespace carrier", () => {
  for (const [label, operationKind, form, arguments_] of [
    ["primitive function", "method", { form: "call", path: "core::primitive::i32::div_euclid" }, [integer, integer]],
    ["primitive constant", "property", { form: "associated-value", owner: integer, name: "MAX" }, []],
  ]) {
    const selected = { operationKind, form, sourceReceiver: { kind: "compile-time" },
      sourceArgumentCarriers: arguments_, resultCarrier: integer, isAsync: false, isFallible: false };
    const abi = finalizeRustProviderOperationAbi(selected);
    assert.equal(abi !== undefined && validateRustFinalizedOperationAbi(abi), true,
      `${label}: the existing finalized ABI accepts actual namespace evidence`);
    assert.equal(abi.sourceReceiver.kind, "compile-time", `${label}: no fictitious namespace value`);
    assert.equal(abi.targetReceiver.kind, "none", `${label}: no runtime receiver allocation or argument`);
    assert.equal(abi.targetArguments.length, arguments_.length, `${label}: every explicit native input remains`);
    for (const [index, input] of abi.targetArguments.entries())
      assert.equal(input.source.kind === "argument" && input.source.sourceIndex === index, true,
        `${label}: source argument ${index} preserves its actual selected order`);
    assert.equal(finalizeRustProviderOperationAbi({ ...selected,
      sourceReceiver: { kind: "compile-time", carrier: integer } }) === undefined, true,
      `${label}: a namespace cannot smuggle a fabricated runtime payload`);
  }
});

test("free-call receiver conversion retains the exact native borrowed-str ABI and rejects mutations", () => {
  const string = rustStringTargetType();
  const borrowed = rustBorrowedStrTargetType();
  for (const form of ["free-call", "free-call-str-slice"]) {
    const selected = { operationKind: "method", form: { form, path: "fixture::read",
      receiverMode: "value", receiverConversion: rustStringToBorrowedStrValueConversion },
      sourceReceiver: { kind: "runtime", carrier: string }, sourceArgumentCarriers: [], resultCarrier: bool,
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
      ["wrong source", { sourceReceiver: { kind: "runtime", carrier: integer } }],
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
  return { operationKind: "method", form, sourceReceiver: { kind: "runtime", carrier: derived,
    declaredCarrier: base }, sourceArgumentCarriers, resultCarrier: bool,
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
  const fact = finalizeProviderOperationFact(template, [], { kind: "runtime", carrier: derived }, emptyRustTypeDefinitions);
  assert.equal(fact !== undefined, true);
  assert.deepEqual(fact.abi.sourceReceiver.declaredCarrier, base);
  assert.equal(fact.abi.targetReceiver.input.conversion.conversion.path, project.path);
});

test("missing, ambiguous and forged receiver owner evidence rejects before planning", () => {
  const original = options({ form: "receiver-method", name: "read" });
  for (const [label, mutation] of [
    ["missing projection", { sourceReceiver: { ...original.sourceReceiver, carrier: rustNamedTargetType("fixture.Other", "fixture::Other") } }],
    ["ambiguous projection", { sourceReceiver: { ...original.sourceReceiver, carrier: rustNamedTargetType("fixture.Derived", "fixture::Derived", [], [], undefined,
      [project, { ...project, path: "fixture::other_base" }]) } }],
    ["missing receiver", { sourceReceiver: undefined }],
    ["malformed owner", { sourceReceiver: { ...original.sourceReceiver, declaredCarrier: {} } }],
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
    sourceReceiver: { kind: "runtime", carrier: source, declaredCarrier: string } });
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
