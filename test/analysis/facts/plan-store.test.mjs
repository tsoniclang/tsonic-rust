import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustPlanBuilder } from "../../../dist/analysis/facts/plan-store.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustContextualValueConversionFactKey, rustOptionProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import {
  rustConversionKey,
  rustRuntimeCarrierKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../../dist/target-model/facts/selections.js";
import {
  rustFinalizedCarrierTransitionMatches,
  rustTargetOperationIsDirectLocation,
  rustTargetOperationSupportsAssignment,
  rustTargetOperationText,
} from "../../../dist/analysis/facts/target-operation.js";

function createModel() {
  return createRustPlanBuilder({ getFact: () => undefined });
}

test("present contextual conversions retain one scalar conversion followed by presence", () => {
  const model = createModel();
  const subject = {};
  const source = { kind: "source-primitive", name: "uint8" };
  const element = { kind: "source-primitive", name: "int32" };
  const option = rustOptionTargetType(element);
  const conversion = { kind: "exact-integer", source, target: element };
  const scalar = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: element, conversion } };
  const optional = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: option,
    conversion: { kind: "option-some", source, element, elementConversion: conversion } } };
  recordRustValueCarrierReconciliation(model, subject, optional);
  assert.doesNotThrow(() => recordRustValueCarrierReconciliation(model, subject, scalar));
  assert.equal(model.getFact(subject, rustContextualValueConversionFactKey)?.targetCarrier, element);
  assert.equal(model.getFact(subject, rustOptionProjectionFactKey)?.sourceCarrier, element);
  assert.equal(rustEffectiveValueCarrier(model, subject), option);
  assert.throws(() => recordRustValueCarrierReconciliation(model, subject,
    { ...scalar, fact: { ...scalar.fact, sourceCarrier: element } }), /Conflicting Rust semantic plan/u);
  for (const mutation of [{ sourceCarrier: element }, { targetCarrier: rustOptionTargetType(source) }]) {
    assert.throws(() => recordRustValueCarrierReconciliation(model, {},
      { ...optional, fact: { ...optional.fact, ...mutation } }), /exact source and selected payload/u);
  }
  const unchanged = {};
  recordRustValueCarrierReconciliation(model, unchanged, { kind: "conversion", fact: {
    sourceCarrier: element, targetCarrier: option,
    conversion: { kind: "option-some", source: element, element, elementConversion: null },
  } });
  assert.equal(model.getFact(unchanged, rustContextualValueConversionFactKey) === undefined, true,
    "unchanged payload does not manufacture a conversion");
  assert.equal(rustEffectiveValueCarrier(model, unchanged), option);
});

test("analysis result probes retain parent facts without mutating the final plan", () => {
  const parent = createModel();
  const subject = {};
  const value = { carrier: { kind: "source-primitive", name: "uint64" } };
  parent.set(subject, rustRuntimeCarrierKey, value);
  const probe = createRustPlanBuilder({ getFact: () => undefined }, undefined, parent);
  assert.equal(probe.getRuntimeCarrierFact(subject), value);
  assert.throws(() => probe.set(subject, rustRuntimeCarrierKey,
    { carrier: { kind: "source-primitive", name: "float64" } }), /Conflicting Rust semantic plan/u);
  const selected = {};
  probe.set(selected, rustRuntimeCarrierKey, value);
  assert.equal(parent.getRuntimeCarrierFact(selected), undefined);
  assert.equal(probe.seal().getRuntimeCarrierFact(selected), value);
  assert.throws(() => probe.set({}, rustRuntimeCarrierKey, value), /after analysis is sealed/u);
  assert.equal(parent.seal().getRuntimeCarrierFact(subject), value);
});

test("source fields retain exact declaration identity when reselected", () => {
  const model = createModel();
  const declaration = { kind: "property", parent: undefined };
  declaration.parent = declaration;
  const fact = {
    kind: "source-field", operationId: "field", declaration,
    accessMode: "read", storage: "project-object", storageIndex: 0,
    receiverCarrier: { kind: "type-parameter", identity: "Owner", name: "Owner" },
    resultCarrier: { kind: "source-primitive", name: "int32" },
    valueSemantics: { kind: "stored" },
  };
  const subject = {};
  model.set(subject, rustTargetOperationFactKey, fact);
  assert.doesNotThrow(() => model.set(subject, rustTargetOperationFactKey,
    { ...fact, resultCarrier: { ...fact.resultCarrier }, valueSemantics: { ...fact.valueSemantics } }));
  for (const mutation of [
    { declaration: { ...declaration } }, { storageIndex: 1 }, { accessMode: "write" },
    { resultCarrier: { kind: "source-primitive", name: "uint32" } },
  ]) {
    assert.throws(() => model.set(subject, rustTargetOperationFactKey, { ...fact, ...mutation }), /Conflicting Rust semantic plan/u);
  }
});

test("closed Rust carrier and conversion facts are allocation-independent", () => {
  const model = createModel();
  const subject = {};
  const firstCarrier = {
    kind: "target-named",
    id: "rust.std.Vec",
    genericArguments: [{
      kind: "type",
      type: { kind: "source-primitive", name: "int32" },
    }],
  };
  const equivalentCarrier = {
    kind: "target-named",
    id: "rust.std.Vec",
    genericArguments: [{
      kind: "type",
      type: { kind: "source-primitive", name: "int32" },
    }],
  };

  model.set(subject, rustRuntimeCarrierKey, { carrier: firstCarrier });
  assert.doesNotThrow(() => model.set(subject, rustRuntimeCarrierKey, { carrier: equivalentCarrier }));
  assert.equal(model.getRuntimeCarrierFact(subject)?.carrier, firstCarrier);
  assert.throws(
    () => model.set(subject, rustRuntimeCarrierKey, { carrier: { kind: "source-primitive", name: "uint8" } }),
    /Conflicting Rust semantic plan/u,
  );

  const conversionSubject = {};
  model.set(conversionSubject, rustConversionKey, { convertedType: firstCarrier });
  assert.doesNotThrow(() => model.set(conversionSubject, rustConversionKey, { convertedType: equivalentCarrier }));
});

test("selected operations compare target data structurally and source provenance exactly", () => {
  const model = createModel();
  const subject = {};
  const sourceExpression = {};
  const first = {
    operationId: "tsonic.rust.operator.concat.string",
    operationKind: "operator",
    targetOperation: "+",
    resultType: { kind: "target-named", id: "rust.std.String" },
    provenance: { sourceExpression },
  };
  const equivalent = {
    operationId: "tsonic.rust.operator.concat.string",
    operationKind: "operator",
    targetOperation: "+",
    resultType: { kind: "target-named", id: "rust.std.String" },
    provenance: { sourceExpression },
  };

  model.set(subject, rustSelectedOperationKey, first);
  assert.doesNotThrow(() => model.set(subject, rustSelectedOperationKey, equivalent));
  assert.throws(
    () => model.set(subject, rustSelectedOperationKey, { ...equivalent, provenance: { sourceExpression: {} } }),
    /Conflicting Rust semantic plan/u,
  );
});

test("selected calls preserve exact checker evidence while accepting equivalent target members", () => {
  const model = createModel();
  const subject = {};
  const sourceSignature = {};
  const selectedType = {};
  const member = {
    id: "acme.run",
    sourceName: "run",
    targetName: "acme::run",
    kind: "method",
    parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" }, passingMode: "value" }],
    returnType: { kind: "source-primitive", name: "int32" },
  };
  const first = {
    member,
    sourceSignature,
    sourceArgumentBindings: [{
      sourceArgumentIndex: 0,
      effectiveArgumentIndex: 0,
      sourceForm: "value",
      sourceParameterIndex: 0,
      sourceParameterForm: "parameter",
      selectedArgumentType: selectedType,
      selectedParameterType: selectedType,
    }],
  };
  const equivalent = {
    ...first,
    member: {
      ...member,
      parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" }, passingMode: "value" }],
      returnType: { kind: "source-primitive", name: "int32" },
    },
    sourceArgumentBindings: [{ ...first.sourceArgumentBindings[0] }],
  };

  model.set(subject, rustSelectedCallKey, first);
  assert.doesNotThrow(() => model.set(subject, rustSelectedCallKey, equivalent));
  assert.throws(
    () => model.set(subject, rustSelectedCallKey, {
      ...equivalent,
      sourceArgumentBindings: [{ ...equivalent.sourceArgumentBindings[0], selectedArgumentType: {} }],
    }),
    /Conflicting Rust semantic plan/u,
  );
});

test("one canonical operation projection serves selection and backend validation", () => {
  assert.equal(rustTargetOperationText({
    kind: "string-concat",
    operationId: "tsonic.rust.operator.concat.string",
    resultCarrier: { kind: "target-named", id: "rust.std.String" },
  }), "+");
  assert.equal(rustTargetOperationText({
    kind: "source-conversion",
    operationId: "tsonic.rust.conversion.identity",
    resultCarrier: { kind: "source-primitive", name: "int32" },
  }), "identity");
});

test("assignment support distinguishes direct Rust places from reference-backed project fields", () => {
  const projectField = {
    kind: "source-field",
    operationId: "source-field",
    storageIndex: 0,
    valueSemantics: { kind: "stored" },
    resultCarrier: { kind: "source-primitive", name: "int32" },
  };
  const providerField = {
    kind: "provider-operation",
    abi: { target: { form: "field", name: "value" } },
  };
  const providerMethod = {
    kind: "provider-operation",
    abi: { target: { form: "receiver-method", name: "value" } },
  };
  assert.equal(rustTargetOperationIsDirectLocation(projectField), false);
  assert.equal(rustTargetOperationSupportsAssignment(projectField, emptyRustTypeDefinitions), true);
  assert.equal(rustTargetOperationIsDirectLocation(providerField), true);
  assert.equal(rustTargetOperationSupportsAssignment(providerField, emptyRustTypeDefinitions), true);
  assert.equal(rustTargetOperationIsDirectLocation(providerMethod), false);
  assert.equal(rustTargetOperationSupportsAssignment(providerMethod, emptyRustTypeDefinitions), false);
  assert.equal(rustTargetOperationIsDirectLocation(undefined), false);
  assert.equal(rustTargetOperationSupportsAssignment(undefined, emptyRustTypeDefinitions), false);
});

test("finalized carrier transitions require one exact conversion lane", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const equivalentInt32 = { kind: "source-primitive", name: "int32" };
  const uint8 = { kind: "source-primitive", name: "uint8" };

  assert.equal(rustFinalizedCarrierTransitionMatches(int32, undefined, equivalentInt32), true);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, int32, equivalentInt32), false);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, uint8, uint8), true);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, undefined, uint8), false);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, equivalentInt32, uint8), false);
});
