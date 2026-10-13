import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../../dist/analysis/conversions/value-carrier-queries.js";




import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";


import { rustFinalizedCarrierTransitionMatches, rustTargetOperationIsDirectLocation, rustTargetOperationSupportsAssignment, rustTargetOperationText } from "../../../../dist/analysis/operations/target-operation.js";

function createModel() {
  return createRustProgramRecordBuilder();
}

test("sealed records publish only frozen typed family readers without a native key or writer API", () => {
  const model = createModel();
  const records = model.seal();
  assert.equal(Object.isFrozen(records), true);
  assert.equal(Object.keys(records).length, 66, "every original native key has one family");
  for (const [name, family] of Object.entries(records)) {
    assert.deepEqual(Object.keys(family), ["get"], name + ": getter-only publication");
    assert.equal(Object.isFrozen(family), true, name + ": immutable family port");
    assert.equal(family.get(undefined) === undefined, true, name + ": absent source identity");
    assert.equal(family.get({}) === undefined, true, name + ": foreign source identity");
    assert.equal(family.get === model[name].get, true, name + ": one getter implementation");
    assert.throws(() => model[name].set({}, undefined), /after analysis is sealed/u, name + ": writer is closed");
  }
  for (const removed of ["get", "getFact", "resolve", "set", "seal", "minimumFoundation"]) {
    assert.equal(Object.hasOwn(records, removed), false, removed + ": no competing public API");
  }
  assert.throws(() => model.seal(), /only once/u);
});

test("scoped native records preserve false values, exact subjects and original conflict checks", () => {
  const parent = createModel();
  const subject = {};
  parent.nativeGuardResult.set(subject, false);
  const inherited = parent.seal();
  const scoped = createRustProgramRecordBuilder(undefined, inherited);
  assert.equal(scoped.nativeGuardResult.get(subject), false, "false is present evidence");
  assert.equal(scoped.nativeGuardResult.get({}) === undefined, true, "equal-looking source is not the owner");
  assert.doesNotThrow(() => scoped.nativeGuardResult.set(subject, false));
  assert.throws(() => scoped.nativeGuardResult.set(subject, true), /Conflicting Rust semantic plan/u);
  const specialized = {};
  scoped.nativeGuardResult.set(specialized, true);
  assert.equal(inherited.nativeGuardResult.get(specialized) === undefined, true, "specialization cannot mutate its parent");
  const records = scoped.seal();
  assert.equal(records.nativeGuardResult.get(subject), false);
  assert.equal(records.nativeGuardResult.get(specialized), true);
  assert.throws(() => scoped.nativeGuardResult.set(specialized, true), /after analysis is sealed/u);
});

test("every finalized contextual conversion family contributes its actual native foundation", () => {
  const source = { kind: "source-primitive", name: "float64" };
  const target = { kind: "source-primitive", name: "int32" };
  const conversion = { kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" };
  const finalized = { kind: "semantic", sourceCarrier: source, targetCarrier: target, conversion, fallible: true };
  const cases = [
    ["contextualValueConversion", { sourceCarrier: source, targetCarrier: target, conversion }],
    ["sourceParameterAbi", { form: "required", valueCarrier: target, parameterCarrier: source,
      mode: "value", entryConversion: conversion }],
    ["futureValue", { outputCarrier: target, awaitedConversion: finalized,
      awaiting: "fallible", errorBoundary: "target-runtime" }],
    ["awaitValue", { operandCarrier: source, resultCarrier: target,
      selection: { kind: "leaf", value: { carrier: source, completion: { kind: "value", conversion: finalized } } } }],
  ];
  for (const [family, fact] of cases) {
    const model = createModel();
    assert.equal(model.minimumFoundation(), "core");
    model[family].set({}, fact);
    assert.equal(model.minimumFoundation(), "alloc", family);
  }
});

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
  assert.equal(model.contextualValueConversion.get(subject)?.targetCarrier, element);
  assert.equal(model.optionProjection.get(subject)?.sourceCarrier, element);
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
  assert.equal(model.contextualValueConversion.get(unchanged) === undefined, true,
    "unchanged payload does not manufacture a conversion");
  assert.equal(rustEffectiveValueCarrier(model, unchanged), option);
});

test("analysis result probes retain parent facts without mutating the final plan", () => {
  const parent = createModel();
  const subject = {};
  const value = { carrier: { kind: "source-primitive", name: "uint64" } };
  parent.runtimeCarrier.set(subject, value);
  const probe = createRustProgramRecordBuilder(undefined, parent);
  assert.equal(probe.runtimeCarrier.get(subject), value);
  assert.throws(() => probe.runtimeCarrier.set(subject, { carrier: { kind: "source-primitive", name: "float64" } }), /Conflicting Rust semantic plan/u);
  const selected = {};
  probe.runtimeCarrier.set(selected, value);
  assert.equal(parent.runtimeCarrier.get(selected), undefined);
  assert.equal(probe.seal().runtimeCarrier.get(selected), value);
  assert.throws(() => probe.runtimeCarrier.set({}, value), /after analysis is sealed/u);
  assert.equal(parent.seal().runtimeCarrier.get(subject), value);
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
  model.targetOperation.set(subject, fact);
  assert.doesNotThrow(() => model.targetOperation.set(subject, { ...fact, resultCarrier: { ...fact.resultCarrier }, valueSemantics: { ...fact.valueSemantics } }));
  for (const mutation of [
    { declaration: { ...declaration } }, { storageIndex: 1 }, { accessMode: "write" },
    { resultCarrier: { kind: "source-primitive", name: "uint32" } },
  ]) {
    assert.throws(() => model.targetOperation.set(subject, { ...fact, ...mutation }), /Conflicting Rust semantic plan/u);
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

  model.runtimeCarrier.set(subject, { carrier: firstCarrier });
  assert.doesNotThrow(() => model.runtimeCarrier.set(subject, { carrier: equivalentCarrier }));
  assert.equal(model.runtimeCarrier.get(subject)?.carrier, firstCarrier);
  assert.throws(
    () => model.runtimeCarrier.set(subject, { carrier: { kind: "source-primitive", name: "uint8" } }),
    /Conflicting Rust semantic plan/u,
  );

  const conversionSubject = {};
  model.conversion.set(conversionSubject, { convertedType: firstCarrier });
  assert.doesNotThrow(() => model.conversion.set(conversionSubject, { convertedType: equivalentCarrier }));
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

  model.selectedOperation.set(subject, first);
  assert.doesNotThrow(() => model.selectedOperation.set(subject, equivalent));
  assert.throws(
    () => model.selectedOperation.set(subject, { ...equivalent, provenance: { sourceExpression: {} } }),
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

  model.selectedCall.set(subject, first);
  assert.doesNotThrow(() => model.selectedCall.set(subject, equivalent));
  assert.throws(
    () => model.selectedCall.set(subject, {
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
