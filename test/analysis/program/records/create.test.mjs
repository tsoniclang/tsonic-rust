import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import { createRustProgramRecordBuilder, createRustProgramRecords } from "../../../../dist/analysis/program/records/create.js";
import { recordRustValueCarrierReconciliation } from "../../../../dist/analysis/program/records/types/value-carrier-admission.js";
import { rustEffectiveValueCarrier } from "../../../../dist/analysis/conversions/value-carrier-queries.js";




import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { rustSourceLocationTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustSourceUnionTargetType } from "../../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { closedMetadataEquals } from "../../../../dist/target-model/metadata/closed-data.js";
import { rustValueConversionContract } from "../../../../dist/policy/conversions/contracts.js";


import { rustFinalizedCarrierTransitionMatches, rustTargetOperationIsDirectLocation, rustTargetOperationSupportsAssignment } from "../../../../dist/policy/operations/members/native-contracts.js";
import { rustTargetOperationText } from "../../../../dist/target-model/operations/text.js";

function createModel() {
  return createRustProgramRecordBuilder();
}

test("location allocation evidence publishes once and seals the exact native owner", () => {
  const model = createModel();
  const subject = {};
  const pointeeCarrier = { kind: "source-primitive", name: "uint32" };
  const carrier = rustSourceLocationTargetType(pointeeCarrier);
  model.locationStoragePlans.allocation(subject, { carrier, pointeeCarrier });
  const evidence = model.locationAllocation.get(subject);
  assert.equal(evidence.carrier === carrier && evidence.pointeeCarrier === pointeeCarrier, true,
    "the selecting owner's exact physical carriers are retained");
  assert.equal(Object.isFrozen(evidence), true, "native allocation evidence is immutable");
  assert.throws(() => model.locationStoragePlans.allocation(subject, { carrier, pointeeCarrier }), /Duplicate Rust semantic plan/u);
  const records = model.seal([{ subject, construct: "allocate", family: "locationAllocation", producer: "analyzeRustLocationStorage" }]);
  assert.equal(records.locationAllocation.get(subject) === evidence, true, "sealing preserves the identical published value");
  assert.equal(records.locationAllocation.get({}) === undefined, true, "a foreign allocation cannot borrow that owner's evidence");
  assert.equal("set" in records.locationAllocation, false, "the renderer receives no allocation writer");
  assert.throws(() => model.locationStoragePlans.allocation({}, { carrier, pointeeCarrier }), /after analysis is sealed/u);
});

test("required native allocation evidence cannot disappear at the seal", () => {
  const model = createModel();
  assert.throws(() => model.seal([{ subject: {}, construct: "allocate", family: "locationAllocation",
    producer: "analyzeRustLocationStorage" }]), /locationAllocation/u);
});

function admitFamily(model, family, subject, fact) {
  if (family === "conversion") { model.conversions.converted(subject, fact.convertedType); return model.conversion.get(subject); }
  if (family === "optionProjection") {
    if (fact.kind === "none") model.optionProjections.none(subject, fact.sourceCarrier, fact.resultCarrier);
    else model.optionProjections.some(subject, fact.sourceCarrier, fact.elementCarrier, fact.resultCarrier);
    return model.optionProjection.get(subject);
  }
  if (family === "flowReadProjection") {
    model.flowReadProjections.project(subject, fact.sourceCarrier, fact.selectedCarrier, fact);
    return model.flowReadProjection.get(subject);
  }
  if (family === "contextualValueConversion") {
    model.contextualValueConversions.convert(subject, fact.sourceCarrier, fact.targetCarrier, fact.conversion);
    return model.contextualValueConversion.get(subject);
  }
  if (family === "runtimeCarrier") model.runtimeCarriers.selected(subject, fact.carrier);
  else if (family === "targetOperation") model.targetOperations.source(subject, fact);
  else if (family === "selectedCall") model.selectedCalls.checked({ source: { call: subject } },
    { kind: "accept", value: { selectedSignature: fact } });
  else if (family === "futureValue") return model.futureValues.resolve(subject, () => fact);
  else if (family === "deferredProducerEffects") model.deferredProducerChannels.finalize(new Map([[subject, fact]]));
  else if (family === "callScopedLifetimeReconciliation") model.callScopedLifetimes.reconcile(subject,
    fact.sourceCarrier, fact.selectedCarrier);
  else if (family === "projectUpcast") model.projectUpcasts.project(subject,
    fact.sourceCarrier, fact.targetCarrier, fact.sourceVariants);
  else if (family === "projectDowncast") model.projectDowncasts.project(subject,
    fact.sourceCarrier, fact.dispatchCarrier, fact.targetCarrier, fact.projection);
  else if (family === "sourceParameterAbi") {
    model.sourceParameterAbis.parameter(subject, fact);
    const selected = model.sourceParameterAbi.get(subject);
    assert.equal(selected !== undefined, true, "the parameter producer admits its constructed ABI");
    for (const field of Object.keys(fact)) {
      assert.equal(selected[field] === fact[field], true, `the exact selected ABI ${field} is retained`);
    }
    return selected;
  }
  else if (family === "awaitValue") {
    assert.equal(fact.selection.kind, "leaf", "the fixture supplies one exact completion");
    const leaf = fact.selection.value;
    assert.equal(leaf.completion.kind, "value", "the fixture supplies a native conversion");
    const conversion = leaf.completion.conversion;
    assert.equal(conversion.kind === "identity" || conversion.kind === "semantic", true, "exact fixture conversion kind");
    return model.awaitValues.finalize(subject, fact.operandCarrier, fact.resultCarrier,
      () => leaf.future, () => conversion.kind === "semantic" ? conversion.conversion : undefined);
  }
  else model[family].set(subject, fact);
  return fact;
}

test("sealed records publish only frozen typed family readers without a native key or writer API", () => {
  const model = createModel();
  const modelRequiredRecords = [];
  model.assertOpen();
  const records = model.seal(modelRequiredRecords);
  assert.equal(Object.hasOwn(records, "assertOpen"), false, "the analysis lifecycle guard is not a backend capability");
  assert.throws(model.assertOpen, /after analysis is sealed/u);
  const subject = {};
  const carrier = { kind: "source-primitive", name: "uint32" };
  const location = rustSourceLocationTargetType(carrier);
  const layout = { kind: "scalar", pointeeCarrier: carrier, size: 4, alignment: 4,
    width: 64, littleEndian: true, fields: [] };
  const producerAdmissions = {
    nativeTaskUse: () => model.nativeTaskPlans.use(subject, { kind: "call", passing: "borrow",
      scope: { name: "scope", carrier, errorCarrier: carrier } }),
    nativeHandler: () => model.nativeHandlers.selected(subject, { kind: "memory-binding", selection: { kind: "field", carrier, expression: subject } }),
    selectedOperation: () => model.selectedOperations.checked(subject, { kind: "accept", value: {} }),
    runtimeCarrier: () => admitFamily(model, "runtimeCarrier", subject, { carrier }),
    selectedCall: () => admitFamily(model, "selectedCall", subject, {}),
    targetOperation: () => admitFamily(model, "targetOperation", subject, {}),
    nativeArrayStorage: () => model.nativeArrays.promote([[subject, "binding"]], subject, layout, 4),
    nativeBacking: () => model.nativeBackings.require(subject, layout),
    rawLocationPlan: () => model.rawLocations.conversion(subject, "to-raw", subject, carrier, layout),
    memoryBindingPlan: () => model.memoryBindings.field(subject, carrier, subject),
    rawAddressPlan: () => model.rawAddresses.identity(subject, "same", carrier, []),
    receiverIndependentMethod: () => model.receiverIndependentMethods.finalize({}, [], () => ""),
    classValue: () => model.classValues.resolve({}, subject, undefined),
    objectLiteralMethodAdapter: () => model.objectLiteralMethodAdapters.finalize({ expressions: new Set() }),
    projectCallableAdapters: () => model.projectCallableAdapterPlans.finalize({}),
    objectReferenceView: () => model.objectReferenceViews.select({}, subject, carrier, carrier),
    awaitSourceErrorEffects: () => model.awaitSourceErrors.selected(subject, []),
    errorEffects: () => model.errorEffectPlans.selected(subject, {}),
    fallible: () => model.fallibleSubjects.selected(subject),
    genericCallableInvocation: () => model.genericCallableInvocations.selected(subject, {}),
    sourceAccessorEffects: () => model.sourceAccessorEffectPlans.selected(subject, false, undefined),
    sourceCallEffects: () => model.sourceCallEffectPlans.selected(subject, "infallible", "not-applicable"),
    sourceErrorEffects: () => model.sourceErrorEdges.invocation(subject, []),
    awaitValue: () => model.awaitValues.finalize(subject, carrier, carrier, () => undefined, () => undefined),
    futureValue: () => model.futureValues.resolve(subject, () => undefined),
    resourceManagement: () => model.resourceManagementPlans.select(subject, {}, {}, () => undefined),
    deferredProducerEffects: () => model.deferredProducerChannels.finalize(new Map()),
    nativeGuardResult: () => model.nativeGuardResults.resolve(subject, () => false),
    nativeUnreachable: () => model.nativeUnreachableNodes.resolve(subject, () => true),
    nativeParticipation: () => model.nativeParticipations.selected(subject, "body"),
    genericNumericOperands: () => model.genericNumerics.comparison(subject, carrier, carrier, undefined),
    indexedFieldKeyArgument: () => model.indexedFieldKeys.selected(subject, carrier, false),
    propertyProjection: () => model.propertyProjections.finalize(subject, undefined, []),
    typeOnlyDeclaration: () => model.typeOnlyDeclarations.finalize({}, []),
    moduleBinding: () => model.moduleBindings.defaultExport(subject, carrier),
    moduleCallableStorage: () => model.moduleCallableStoragePlans.finalize({}),
    sourceCallableReturn: () => model.sourceCallableReturns.setter(subject),
    capturedFieldStorage: () => model.capturedFieldStoragePlans.resolve({}, subject, carrier),
    callScopedLifetimeReconciliation: () => model.callScopedLifetimes.reconcile(subject, carrier, carrier),
    projectUpcast: () => model.projectUpcasts.project(subject, carrier, carrier),
    projectDowncast: () => model.projectDowncasts.project(subject, carrier, carrier, carrier, { kind: "generic" }),
    asyncFunction: () => model.asyncFunctions.native(subject, carrier),
    yield: () => model.yields.value(subject, subject, {}),
    computedMember: () => model.computedMembers.evaluate({}, subject, subject, subject, "read"),
    compoundWrite: () => model.compoundWrites.index(subject, "native.index-set", {}),
    typeAliasDeclaration: () => model.typeAliasDeclarations.register({}, subject),
    mutatedBinding: () => model.mutatedBindings.written(subject),
    mutatedReferent: () => model.mutatedReferents.written(subject,
      { target: subject, receivers: [{ expression: subject, use: subject }] }),
    argumentPassing: () => model.argumentPassingPlans.pass(subject, "by-value"),
    typedLocationPlan: () => model.typedLocations.finalize(subject, carrier, location, { operation: "load", pointerExpression: subject }),
    bindingStorage: () => model.bindingStoragePlans.capture(subject, carrier, { storage: "location" }),
    retainedCallLifetimes: () => model.retainedCalls.finalize(subject, new Map([["region", { kind: "static" }]])),
    bindingProjection: () => model.bindingProjections.resolve([], subject, carrier, carrier, { kind: "tuple-element", index: 0 }),
    compileTimeSource: () => model.compileTimeSources.erase(subject),
    selfMode: () => model.selfModes.method(subject, "ref"),
    memoryLayoutObservation: () => model.memoryLayoutObservations.observe(subject, 0),
    generator: () => model.generators.suspend(subject,
      { kind: "sync", yieldType: carrier, returnType: carrier, nextType: carrier },
      { capturedParameters: [], storage: { kind: "static" } }),
    sourceParameterAbi: () => model.sourceParameterAbis.parameter(subject,
      { form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value" }),
    sourceBinding: () => model.sourceBindings.lexical(subject, subject, "authored"),
    sourceCallableValue: () => model.sourceCallableValues.function(subject, subject, "source.ts", "step", carrier, [], carrier),
    directCallableReference: () => model.directCallableReferences.function(subject, subject, "source.ts", "step", carrier, [], carrier),
    retainedEnvironment: () => model.retainedEnvironments.retain(subject,
      { kind: "parameter", identity: "environment", name: "environment" }, []),
    preparedOperationResult: () => model.preparedOperations.prepare(subject,
      { operationId: "fixture:prepared", operationKind: "method" }, carrier),
    optionalChain: () => model.optionalChains.guard(subject, subject, "property",
      { sourceGuardCarrier: carrier, selectedGuardCarrier: carrier, guardDepth: 1,
        innerResultCarrier: carrier, resultCarrier: carrier, lowering: "map" }),
    closureCapture: () => model.closureCaptures.capture(subject, []),
    conversion: () => model.conversions.converted(subject, carrier),
    optionProjection: () => model.optionProjections.none(subject, carrier, carrier),
    flowReadProjection: () => model.flowReadProjections.project(subject, carrier, carrier, { kind: "closed-native" }),
    contextualValueConversion: () => model.contextualValueConversions.convert(subject, carrier, carrier,
      { kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" }),
  };
  assert.equal(Object.keys(producerAdmissions).length, 69, "every producer has a seal refusal witness");
  assert.equal(Object.isFrozen(records), true);
  assert.equal(Object.keys(records).length, 347, "every native key has one family");
  for (const [name, family] of Object.entries(records)) {
    assert.deepEqual(Object.keys(family), ["get"], name + ": getter-only publication");
    assert.equal(Object.isFrozen(family), true, name + ": immutable family port");
    assert.equal(family.get(undefined) === undefined, true, name + ": absent source identity");
    assert.equal(family.get({}) === undefined, true, name + ": foreign source identity");
    assert.equal(family.get === model[name].get, true, name + ": one getter implementation");
    const admission = producerAdmissions[name];
    if (admission !== undefined) {
      assert.equal(model[name].set === undefined, true, name + ": no general writer");
      assert.throws(admission, /after analysis is sealed/u, name + ": producer is closed");
    } else if (typeof model[name].set === "function") {
      assert.throws(() => model[name].set({}, undefined), /after analysis is sealed/u, name + ": writer is closed");
    } else {
      assert.equal(model[name].set, undefined, name + ": producer-owned family has no general writer");
    }
  }
  for (const removed of ["get", "getFact", "resolve", "set", "seal", "minimumFoundation"]) {
    assert.equal(Object.hasOwn(records, removed), false, removed + ": no competing public API");
  }
  assert.throws(() => model.seal(modelRequiredRecords), /only once/u);
});

test("the backend projection removes exactly five applicability families and preserves every other reader by identity", () => {
  const builder = createModel();
  const subject = {};
  const payload = Object.freeze({ kind: "field", carrier: { kind: "source-primitive", name: "int32" }, expression: subject });
  const handler = Object.freeze({ kind: "memory-binding", selection: payload });
  builder.nativeHandlers.selected(subject, handler);
  assert.equal(builder.nativeHandler.get(subject) === handler, true);
  assert.throws(() => builder.nativeHandlers.selected(subject, handler), /Duplicate Rust semantic plan/u);
  const analysis = builder.seal([]);
  const records = createRustProgramRecords(analysis);
  const removed = new Set(["memoryBindingPlan", "rawLocationPlan", "rawAddressPlan", "memoryLayoutObservation", "typedLocationPlan"]);
  assert.equal(Object.keys(analysis).length, 347);
  assert.equal(Object.keys(records).length, 342);
  assert.equal(Object.isFrozen(records), true);
  for (const [family, reader] of Object.entries(analysis)) {
    if (removed.has(family)) {
      assert.equal(Object.hasOwn(records, family), false, family);
      assert.throws(() => records[family].get(subject), TypeError, family);
    } else assert.equal(records[family] === reader, true, family);
  }
  const child = createRustProgramRecordBuilder(undefined, analysis);
  child.nativeHandlers.selected(subject, Object.freeze({ kind: "memory-binding", selection: payload }));
  assert.equal(child.nativeHandler.get(subject) === handler, true, "inherited publication keeps the exact payload and descriptor");
  child.seal([]);
  assert.throws(() => child.nativeHandlers.selected({}, handler), /after analysis is sealed/u);
});

test("scoped guard producers preserve false, exact subjects and parent isolation without reselecting", () => {
  const parent = createModel();
  const parentRequiredRecords = [];
  const subject = {};
  parent.nativeGuardResults.resolve(subject, () => false);
  const inherited = parent.seal(parentRequiredRecords);
  const scoped = createRustProgramRecordBuilder(undefined, inherited);
  assert.equal(scoped.nativeGuardResult.get(subject), false, "false is present evidence");
  assert.equal(scoped.nativeGuardResult.get({}) === undefined, true, "equal-looking source is not the owner");
  let reselections = 0;
  for (const value of [false, true]) {
    assert.equal(scoped.nativeGuardResults.resolve(subject, () => { reselections += 1; return value; }), false,
      "a checked inherited guard is the canonical decision");
  }
  assert.equal(reselections, 0, "the producer does not recompute or replace inherited evidence");
  const specialized = {};
  scoped.nativeGuardResults.resolve(specialized, () => true);
  assert.equal(inherited.nativeGuardResult.get(specialized) === undefined, true, "specialization cannot mutate its parent");
  const records = scoped.seal([]);
  assert.equal(records.nativeGuardResult.get(subject), false);
  assert.equal(records.nativeGuardResult.get(specialized), true);
  assert.throws(() => scoped.nativeGuardResults.resolve(specialized, () => true), /after analysis is sealed/u);
});

test("every finalized contextual conversion family contributes its actual native foundation", () => {
  const source = { kind: "source-primitive", name: "float64" };
  const target = { kind: "source-primitive", name: "int32" };
  const conversion = { kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" };
  const finalized = { kind: "semantic", sourceCarrier: source, targetCarrier: target, conversion, fallible: true };
  const cases = [
    ["contextualValueConversion", { sourceCarrier: source, targetCarrier: target, conversion }],
    ["sourceParameterAbi", { form: "required", valueCarrier: target, parameterCarrier: source,
      mode: "value", entryConversion: Object.freeze({ conversion, contract: rustValueConversionContract(conversion) }) }],
    ["futureValue", { outputCarrier: target, awaitedConversion: finalized,
      awaiting: "fallible", errorBoundary: "target-runtime" }],
    ["awaitValue", { operandCarrier: source, resultCarrier: target,
      selection: { kind: "leaf", value: { carrier: source, completion: { kind: "value", conversion: finalized } } } }],
  ];
  for (const [family, fact] of cases) {
    const model = createModel();
    const modelRequiredRecords = [];
    assert.equal(model.minimumFoundation(), "core");
    admitFamily(model, family, {}, fact);
    assert.equal(model.minimumFoundation(), "alloc", family);
  }
});

test("all nine foundation-bearing families account through their typed admission", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const floating = { kind: "source-primitive", name: "float64" };
  const text = { kind: "target-named", id: "rust.std.String" };
  const nativeError = { kind: "target-named", id: "acme.native.Failure" };
  const conversion = { kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" };
  const identity = { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false };
  const finalized = { kind: "semantic", sourceCarrier: floating, targetCarrier: integer, conversion, fallible: true };
  const cases = [
    ["runtimeCarrier", { carrier: text }, "alloc"],
    ["selectedCall", { member: { id: "native.call", sourceName: "call", targetName: "std::thread::current",
      kind: "method", parameters: [], returnType: integer } }, "std"],
    ["conversion", { convertedType: text }, "alloc"],
    ["targetOperation", { kind: "operator-call", operationId: "native.add", operator: "+",
      path: "std::ops::Add::add", resultCarrier: integer, fallible: false, operandModes: ["value", "value"] }, "std"],
    ["contextualValueConversion", { sourceCarrier: floating, targetCarrier: integer, conversion }, "alloc"],
    ["sourceParameterAbi", { form: "required", valueCarrier: integer, parameterCarrier: floating,
      mode: "value", entryConversion: Object.freeze({ conversion, contract: rustValueConversionContract(conversion) }) }, "alloc"],
    ["futureValue", { outputCarrier: integer, awaitedConversion: identity, awaiting: "fallible",
      errorBoundary: "target-runtime", errorCarrier: nativeError }, "std"],
    ["deferredProducerEffects", { kind: "futures", channels: [{ awaiting: "infallible", errorCarrier: integer },
      { awaiting: "fallible", errorCarrier: nativeError }] }, "std"],
    ["awaitValue", { operandCarrier: floating, resultCarrier: integer,
      selection: { kind: "leaf", value: { carrier: floating, completion: { kind: "value", conversion: finalized } } } }, "alloc"],
  ];
  for (const [family, fact, expected] of cases) {
    const builder = createModel();
    const builderRequiredRecords = [];
    const subject = {};
    assert.equal(builder.minimumFoundation(), "core", family + ": initially core");
    const selected = admitFamily(builder, family, subject, fact);
    assert.equal(builder.minimumFoundation(), expected, family);
    const admitted = builder[family].get(subject);
    assert.equal(closedMetadataEquals(selected, fact), true, family + ": full original native evidence retained");
    assert.equal(family === "runtimeCarrier" ? admitted?.carrier === fact.carrier : admitted === selected,
      true, family + ": exact producer input retained");
    if (family === "futureValue") {
      assert.doesNotThrow(() => admitFamily(builder, family, subject, fact), family + ": complete query retains canonical evidence");
    } else assert.throws(() => admitFamily(builder, family, subject, fact), /Duplicate Rust semantic plan/u, family);
    assert.equal(builder[family].get(subject) === admitted, true, family + ": same canonical record");
    builder.seal(builderRequiredRecords);
    assert.equal(builder.minimumFoundation(), expected, family + ": sealed accounting");
  }
  for (const [family, fact] of [["conversion", {}], ["deferredProducerEffects", { kind: "no-future" }],
    ["deferredProducerEffects", { kind: "futures", channels: [] }]]) {
    const builder = createModel();
    const builderRequiredRecords = [];
    admitFamily(builder, family, {}, fact);
    assert.equal(builder.minimumFoundation(), "core", family + ": absent native requirement");
  }
});

test("all definition-dependent foundation admissions retain the supplied source-union definitions", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const union = rustSourceUnionTargetType("/src/foundation.ts", "Choice");
  const variants = [{ name: "Integer", carrier: integer },
    { name: "Text", carrier: { kind: "target-named", id: "rust.std.String" } }];
  const conversion = { kind: "source-union-variant", source: integer, target: union,
    variantName: "Integer", payloadCarrier: integer, payloadConversion: null };
  const finalized = { kind: "semantic", sourceCarrier: integer, targetCarrier: union, conversion, fallible: false };
  const entryConversion = Object.freeze({ conversion, contract: rustValueConversionContract(conversion,
    { ...emptyRustTypeDefinitions, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, union) ? variants : undefined }) });
  const cases = [
    ["targetOperation", { kind: "source-conversion", operationId: "native.inject", conversion, resultCarrier: union }],
    ["contextualValueConversion", { sourceCarrier: integer, targetCarrier: union, conversion }],
    ["sourceParameterAbi", { form: "required", valueCarrier: union, parameterCarrier: integer,
      mode: "value", entryConversion }],
    ["futureValue", { outputCarrier: union, awaitedConversion: finalized, awaiting: "infallible", errorBoundary: "none" }],
    ["awaitValue", { operandCarrier: integer, resultCarrier: union,
      selection: { kind: "leaf", value: { carrier: integer, completion: { kind: "value", conversion: finalized } } } }],
  ];
  for (const [family, fact] of cases) {
    let definitionReads = 0;
    const definitions = { ...emptyRustTypeDefinitions, sourceUnionVariants: carrier => {
      definitionReads += 1;
      return rustTargetTypeRefEquals(carrier, union) ? variants : undefined;
    } };
    const builder = createRustProgramRecordBuilder(definitions);
    const builderRequiredRecords = [];
    const subject = {};
    const selected = admitFamily(builder, family, subject, fact);
    assert.equal(definitionReads > 0, true, family + ": actual source definitions used");
    const beforeReads = definitionReads;
    for (let read = 0; read < 32; read += 1) {
      assert.equal(closedMetadataEquals(selected, fact), true, family + ": full original native evidence retained");
      assert.equal(builder[family].get(subject) === selected, true, family + ": same admitted evidence");
      assert.equal(builder.minimumFoundation(), "core", family + ": no unused union payload cost");
    }
    builder.seal(builderRequiredRecords);
    assert.equal(definitionReads, beforeReads, family + ": reads and seal do not recompute");
    const missingDefinitions = createModel();
    const rejectedSubject = {};
    if (family === "awaitValue") {
      assert.equal(admitFamily(missingDefinitions, family, rejectedSubject, fact) === undefined, true,
        family + ": missing definitions reject during native completion selection");
      assert.equal(missingDefinitions[family].get(rejectedSubject) === undefined, true,
        family + ": no unproven completion is published");
      assert.equal(missingDefinitions.minimumFoundation(), "core", family + ": rejected completion adds no demand");
    } else {
      assert.throws(() => admitFamily(missingDefinitions, family, rejectedSubject, fact), /no valid (?:lowering|foundation) contract/u,
        family + ": missing source definitions cannot silently substitute");
    }
  }
});

test("inherited foundation accounting happens on successful admission, never on read or conflict", () => {
  const subject = {};
  const value = { carrier: { kind: "target-named", id: "rust.std.String" } };
  const parent = createModel();
  const parentRequiredRecords = [];
  parent.runtimeCarriers.selected(subject, value.carrier);
  const original = parent.runtimeCarrier.get(subject);
  const records = parent.seal(parentRequiredRecords);
  const child = createRustProgramRecordBuilder(undefined, records);
  const childRequiredRecords = [];
  assert.equal(child.runtimeCarrier.get(subject) === original, true);
  assert.equal(child.minimumFoundation(), "core", "inheritance alone retains the original accounting rule");
  child.runtimeCarriers.selected(subject, { ...value.carrier });
  assert.equal(child.minimumFoundation(), "alloc");
  const rejected = createRustProgramRecordBuilder(undefined, records);
  assert.throws(() => rejected.runtimeCarriers.selected(subject,
    { kind: "target-named", id: "acme.external.Type" }), /Conflicting Rust semantic plan/u);
  assert.equal(child.minimumFoundation(), "alloc", "rejected evidence cannot raise the requirement");
  assert.equal(rejected.minimumFoundation(), "core", "a conflicting first inherited admission never adds a native requirement");
  assert.equal(child.runtimeCarrier.get(subject) === original, true, "no inherited evidence replacement");
});

test("present contextual conversions retain one scalar conversion followed by presence", () => {
  const model = createModel();
  const modelRequiredRecords = [];
  const subject = {};
  const source = { kind: "source-primitive", name: "uint8" };
  const element = { kind: "source-primitive", name: "int32" };
  const option = rustOptionTargetType(element);
  const conversion = { kind: "exact-integer", source, target: element };
  const scalar = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: element, conversion } };
  const optional = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: option,
    conversion: { kind: "option-some", source, element, elementConversion: conversion } } };
  recordRustValueCarrierReconciliation(model, modelRequiredRecords, subject, optional);
  assert.doesNotThrow(() => recordRustValueCarrierReconciliation(model, modelRequiredRecords, subject, scalar));
  assert.equal(model.contextualValueConversion.get(subject)?.targetCarrier, element);
  assert.equal(model.optionProjection.get(subject)?.sourceCarrier, element);
  assert.equal(rustEffectiveValueCarrier(model, subject), option);
  assert.throws(() => recordRustValueCarrierReconciliation(model, modelRequiredRecords, subject,
    { ...scalar, fact: { ...scalar.fact, sourceCarrier: element } }), /Conflicting Rust semantic plan/u);
  for (const mutation of [{ sourceCarrier: element }, { targetCarrier: rustOptionTargetType(source) }]) {
    assert.throws(() => recordRustValueCarrierReconciliation(model, modelRequiredRecords, {},
      { ...optional, fact: { ...optional.fact, ...mutation } }), /exact source and selected payload/u);
  }
  const unchanged = {};
  recordRustValueCarrierReconciliation(model, modelRequiredRecords, unchanged, { kind: "conversion", fact: {
    sourceCarrier: element, targetCarrier: option,
    conversion: { kind: "option-some", source: element, element, elementConversion: null },
  } });
  assert.equal(model.contextualValueConversion.get(unchanged) === undefined, true,
    "unchanged payload does not manufacture a conversion");
  assert.equal(rustEffectiveValueCarrier(model, unchanged), option);
});

test("analysis result probes retain parent facts without mutating the final plan", () => {
  const parent = createModel();
  const parentRequiredRecords = [];
  const subject = {};
  const value = { carrier: { kind: "source-primitive", name: "uint64" } };
  parent.runtimeCarriers.selected(subject, value.carrier);
  const original = parent.runtimeCarrier.get(subject);
  const probe = createRustProgramRecordBuilder(undefined, parent);
  assert.equal(probe.runtimeCarrier.get(subject) === original, true);
  assert.throws(() => probe.runtimeCarriers.selected(subject, { kind: "source-primitive", name: "float64" }), /Conflicting Rust semantic plan/u);
  const selected = {};
  probe.runtimeCarriers.selected(selected, value.carrier);
  const specialized = probe.runtimeCarrier.get(selected);
  assert.equal(parent.runtimeCarrier.get(selected), undefined);
  assert.equal(probe.seal([]).runtimeCarrier.get(selected) === specialized, true);
  assert.throws(() => probe.runtimeCarriers.selected({}, value.carrier), /after analysis is sealed/u);
  assert.equal(parent.seal(parentRequiredRecords).runtimeCarrier.get(subject) === original, true);
});

test("source fields retain exact declaration identity when reselected", () => {
  const model = createModel();
  const modelRequiredRecords = [];
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
  model.targetOperations.source(subject, fact);
  assertRustInheritedRecordCorrespondence("targetOperation", subject, fact,
    candidate => candidate.targetOperations.source(subject, { ...fact, resultCarrier: { ...fact.resultCarrier }, valueSemantics: { ...fact.valueSemantics } }));
  for (const mutation of [
    { declaration: { ...declaration } }, { storageIndex: 1 }, { accessMode: "write" },
    { resultCarrier: { kind: "source-primitive", name: "uint32" } },
  ]) {
    assertRustInheritedRecordConflict("targetOperation", subject, fact,
      candidate => candidate.targetOperations.source(subject, { ...fact, ...mutation }), /Conflicting Rust semantic plan/u);
  }
});

test("closed Rust carrier and conversion facts are allocation-independent", () => {
  const model = createModel();
  const modelRequiredRecords = [];
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

  model.runtimeCarriers.selected(subject, firstCarrier);
  assertRustInheritedRecordCorrespondence("runtimeCarrier", subject, model.runtimeCarrier.get(subject),
    candidate => candidate.runtimeCarriers.selected(subject, equivalentCarrier));
  assert.equal(model.runtimeCarrier.get(subject)?.carrier, firstCarrier);
  assertRustInheritedRecordConflict("runtimeCarrier", subject, model.runtimeCarrier.get(subject),
    candidate => candidate.runtimeCarriers.selected(subject, { kind: "source-primitive", name: "uint8" }),
    /Conflicting Rust semantic plan/u,
  );

  const conversionSubject = {};
  model.conversions.converted(conversionSubject, firstCarrier);
  assertRustInheritedRecordCorrespondence("conversion", conversionSubject, model.conversion.get(conversionSubject),
    candidate => candidate.conversions.converted(conversionSubject, equivalentCarrier));
});

test("selected operations compare target data structurally and source provenance exactly", () => {
  const model = createModel();
  const modelRequiredRecords = [];
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

  model.selectedOperations.checked(subject, { kind: "accept", value: { operation: first } });
  assertRustInheritedRecordCorrespondence("selectedOperation", subject, first,
    candidate => candidate.selectedOperations.checked(subject, { kind: "accept", value: { operation: equivalent } }));
  assertRustInheritedRecordConflict("selectedOperation", subject, first,
    candidate => candidate.selectedOperations.checked(subject, { kind: "accept", value: {
      operation: { ...equivalent, provenance: { sourceExpression: {} } },
    } }),
    /Conflicting Rust semantic plan/u,
  );
});

test("selected calls preserve exact checker evidence while accepting equivalent target members", () => {
  const model = createModel();
  const modelRequiredRecords = [];
  const subject = {};
  const sourceSignature = {};
  const sourceParameter = {};
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
    nativeParameterDeclarations: [sourceParameter],
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

  admitFamily(model, "selectedCall", subject, first);
  assertRustInheritedRecordCorrespondence("selectedCall", subject, model.selectedCall.get(subject),
    candidate => admitFamily(candidate, "selectedCall", subject, equivalent));
  assertRustInheritedRecordConflict("selectedCall", subject, model.selectedCall.get(subject),
    candidate => admitFamily(candidate, "selectedCall", subject, {
      ...equivalent,
      sourceArgumentBindings: [{ ...equivalent.sourceArgumentBindings[0], selectedArgumentType: {} }],
    }),
    /Conflicting Rust semantic plan/u,
  );
  assertRustInheritedRecordConflict("selectedCall", subject, model.selectedCall.get(subject),
    candidate => admitFamily(candidate, "selectedCall", subject, {
      ...equivalent,
      nativeParameterDeclarations: [{}],
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
