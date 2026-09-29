import assert from "node:assert/strict";
import test from "node:test";
import { materializeRustOmittedCallArguments } from "../../../dist/analysis/operations/provider/calls/omitted-arguments.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { rustOptionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { substituteProviderOperationForm } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";

test("omitted provider arguments require checked optional slots and exact native Option carriers", () => {
  const string = rustStringTargetType();
  const optional = rustOptionTargetType(string);
  const request = { source: { sourceArguments: [{}], sourceArgumentBindings: [{ sourceArgumentIndex: 0,
    sourceParameterIndex: 0, sourceForm: "value", sourceParameterForm: "parameter" }] } };
  const slots = ["required", "optional", "optional"].map((form, sourceParameterIndex) => ({
    form, sourceParameterIndex, sourceParameterName: `arg${sourceParameterIndex}` }));
  const context = { currentSemantics: { operations: { callParameterSlots: () => slots } } };
  const template = { operationKind: "method", parameterCarriers: [string, optional, optional],
    resultCarrier: string, target: { form: "call", path: "acme::call", argModes: ["ref", "value", "value"],
      trailingArguments: [{ kind: "boolean", value: true }] } };
  const before = structuredClone(template);
  const selected = materializeRustOmittedCallArguments(request, template, context);
  assert.deepEqual(template, before);
  assert.deepEqual(selected.parameterCarriers, [string]);
  assert.deepEqual(selected.target.argModes, ["ref"]);
  assert.deepEqual(selected.target.trailingArguments, [{ kind: "none", element: string }, { kind: "none", element: string }, { kind: "boolean", value: true }]);
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method", form: selected.target,
    sourceArgumentCarriers: [string], declaredSourceArgumentCarriers: selected.parameterCarriers,
    resultCarrier: string, isAsync: false, isFallible: false });
  assert.ok(abi);
  assert.equal(abi.sourceArguments.length, 1);
  assert.equal(abi.targetArguments.length, 4);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  for (const element of [{ kind: "guess" }, null, { kind: "source-primitive", name: "string", extra: true }]) {
    const altered = structuredClone(abi);
    altered.targetArguments[1].source.value.element = element;
    assert.equal(validateRustFinalizedOperationAbi(altered), false);
  }
  const inconsistent = structuredClone(abi);
  inconsistent.targetArguments[1] = { source: { kind: "constant", value: {
    kind: "none", element: { kind: "source-primitive", name: "bool" },
  } } };
  assert.equal(validateRustFinalizedOperationAbi(inconsistent), false);
  for (const changed of [
    { ...template, parameterCarriers: [string, string, optional] },
    { ...template, target: { ...template.target, argModes: ["ref", "ref", "value"] } },
    { ...template, target: { ...template.target, argOrder: [1, 0, 2] } },
    { ...template, target: { ...template.target, argOrder: [0, 1, 1] } },
    { ...template, target: { ...template.target, argConversions: [undefined, { kind: "semantic-conversion", id: "other" }] } },
  ]) assert.equal(materializeRustOmittedCallArguments(request, changed, context), undefined);
  for (const form of ["required", "rest"]) {
    const changed = { currentSemantics: { operations: { callParameterSlots: () => [slots[0], { ...slots[1], form }, slots[2]] } } };
    assert.equal(materializeRustOmittedCallArguments(request, template, changed), undefined);
  }
  assert.equal(materializeRustOmittedCallArguments({ source: { sourceArguments: [{}], sourceArgumentBindings: [] } }, template, context), undefined);
});

test("typed native absence retains generic substitutions in every constant-bearing operation", () => {
  const parameter = { kind: "type-parameter", identity: "acme:T", name: "T" };
  const element = rustStringTargetType();
  const bindings = { types: new Map([["acme:T", element]]), lifetimes: new Map(), consts: new Map() };
  for (const target of [
    { form: "call", path: "acme::call" },
    { form: "free-call", path: "acme::call", receiverMode: "ref" },
    { form: "receiver-method", name: "call" },
    { form: "arg-structural-method", storageIndex: 0 },
  ]) {
    const form = { ...target, trailingArguments: [{ kind: "none", element: parameter }] };
    const substituted = substituteProviderOperationForm(form, bindings);
    assert.deepEqual(substituted.trailingArguments, [{ kind: "none", element }]);
    assert.deepEqual(form.trailingArguments, [{ kind: "none", element: parameter }]);
  }
});
