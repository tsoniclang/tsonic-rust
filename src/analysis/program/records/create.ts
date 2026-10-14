import type { RustPlanKey } from "./key.js";
import type { RustProgramRecordBuilder } from "./model.js";
import { createRustRecordFamily } from "./family.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";
import { rustFoundationForCarrier } from "../../foundation/requirements.js";
import { rustFoundationForContextualConversion, rustFoundationForValueConversion } from "../../foundation/conversion-requirements.js";
import { rustTypeAliasDeclarationFactKey, rustAsyncFunctionFactKey, rustGeneratorFactKey, rustYieldFactKey, rustSourceParameterAbiFactKey } from "./keys/callables-and-resources.js";
import { rustConversionKey, rustArgumentPassingKey } from "./keys/selections.js";
import { createRustSelectedOperationProducer } from "./selected-operation.js";
import { createRustRuntimeCarrierProducer } from "./runtime-carrier.js";
import { createRustSelectedCallProducer } from "./selected-call.js";
import { createRustTargetOperationProducer } from "./target-operation.js";
import { createRustReceiverIndependentMethodProducer } from "./receiver-independent-method.js";
import { createRustClassValueProducer } from "./class-value.js";
import { createRustObjectLiteralMethodAdapterProducer } from "./object-literal-method-adapter.js";
import { createRustProjectCallableAdapterProducer } from "./project-callable-adapters.js";
import { createRustObjectReferenceViewProducer } from "./object-reference-view.js";
import { createRustAwaitSourceErrorEffectsProducer } from "./await-source-error-effects.js";
import { createRustErrorEffectsProducer } from "./error-effects.js";
import { createRustFallibleProducer } from "./fallible.js";
import { createRustGenericCallableInvocationProducer } from "./generic-callable-invocation.js";
import { createRustSourceAccessorEffectsProducer } from "./source-accessor-effects.js";
import { createRustSourceCallEffectsProducer } from "./source-call-effects.js";
import { createRustSourceErrorEffectsProducer } from "./source-error-effects.js";
import { createRustAwaitValueProducer } from "./await-value.js";
import { createRustFutureValueProducer } from "./future-value.js";
import { createRustResourceManagementProducer } from "./resource-management.js";
import { createRustDeferredProducerEffectsProducer } from "./deferred-producer-effects.js";
import { rustNativeGuardResultFactKey, rustNativeUnreachableFactKey } from "./keys/native-control-flow.js";
import { rustCompileTimeSourceKey, rustSourceCallableReturnFactKey } from "./keys/source-declarations.js";
import { rustOptionProjectionFactKey, rustFlowReadProjectionFactKey, rustContextualValueConversionFactKey, rustCallScopedLifetimeReconciliationFactKey, rustProjectUpcastFactKey, rustProjectDowncastFactKey, rustSourceBindingFactKey, rustBindingProjectionFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustSelfModeFactKey } from "./keys/value-projections.js";
import { rustCompoundWriteFactKey, rustComputedMemberFactKey, rustPreparedOperationResultFactKey, rustOptionalChainFactKey, rustTypedLocationPlanKey, rustBindingStorageFactKey, rustClosureCaptureFactKey, rustSourceCallableValueFactKey, rustDirectCallableReferenceFactKey, rustModuleBindingFactKey } from "./keys/operation-selections.js";
import { rustTypeOnlyDeclarationFactKey } from "./keys/type-only.js";
import { createRustNativeArrayStorageProducer } from "./native-array-storage.js";
import { createRustNativeBackingProducer } from "./native-backing.js";
import { createRustRawLocationProducer } from "./raw-locations.js";
import { rustIndexedFieldKeyArgument } from "./keys/indexed-field-keys.js";
import { rustRetainedEnvironmentFactKey, rustRetainedCallLifetimesFactKey } from "./keys/retained-environments.js";
import { rustGenericNumericOperandsKey } from "./keys/generic-numeric.js";
import { rustModuleCallableStorageFactKey } from "./keys/module-values.js";
import { rustCapturedFieldStorageFactKey } from "./keys/receiver-captures.js";
import { rustPropertyProjectionFactKey } from "./keys/property-projections.js";
import { createRustMemoryBindingProducer } from "./memory-bindings.js";
import { createRustRawAddressProducer } from "./raw-addresses.js";
import { rustMemoryLayoutObservationKey } from "./keys/memory-layout.js";

export function createRustProgramRecordBuilder(
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  parent?: RustProgramRecords,
): RustProgramRecordBuilder {
  let sealed = false;
  let minimumFoundation: RustFoundation = "core";
  const assertOpen = (): void => {
    if (sealed) throw new Error("Rust semantic plans cannot be written after analysis is sealed.");
  };
  const requireFoundation = (foundation: RustFoundation): void => {
    minimumFoundation = maximumRustFoundation(minimumFoundation, foundation);
  };
  const createFamily = <T>(
    key: RustPlanKey<T>,
    inherited?: RustRecordFamily<T>,
    foundation?: (value: T) => RustFoundation,
  ) => createRustRecordFamily(key, assertOpen, inherited, foundation === undefined ? undefined : value => {
    requireFoundation(foundation(value));
  });

  const typeAliasDeclaration = createFamily(rustTypeAliasDeclarationFactKey, parent?.typeAliasDeclaration);
  const asyncFunction = createFamily(rustAsyncFunctionFactKey, parent?.asyncFunction);
  const generator = createFamily(rustGeneratorFactKey, parent?.generator);
  const yielded = createFamily(rustYieldFactKey, parent?.yield);
  const resourceManagementPlans = createRustResourceManagementProducer(assertOpen, parent?.resourceManagement);
  const sourceParameterAbi = createFamily(rustSourceParameterAbiFactKey, parent?.sourceParameterAbi, fact => {
    const carriers = maximumRustFoundation(rustFoundationForCarrier(fact.valueCarrier),
      rustFoundationForCarrier(fact.parameterCarrier));
    return fact.entryConversion === undefined ? carriers : maximumRustFoundation(carriers,
      rustFoundationForValueConversion(fact.entryConversion, definitions));
  });
  const runtimeCarriers = createRustRuntimeCarrierProducer(assertOpen, requireFoundation, parent?.runtimeCarrier);
  const selectedCalls = createRustSelectedCallProducer(assertOpen, requireFoundation, parent?.selectedCall);
  const selectedOperations = createRustSelectedOperationProducer(parent?.selectedOperation);
  const conversion = createFamily(rustConversionKey, parent?.conversion,
    value => value.convertedType === undefined ? "core" : rustFoundationForCarrier(value.convertedType));
  const argumentPassing = createFamily(rustArgumentPassingKey, parent?.argumentPassing);
  const nativeGuardResult = createFamily(rustNativeGuardResultFactKey, parent?.nativeGuardResult);
  const nativeUnreachable = createFamily(rustNativeUnreachableFactKey, parent?.nativeUnreachable);
  const awaitValues = createRustAwaitValueProducer(assertOpen, requireFoundation, definitions, parent?.awaitValue);
  const compileTimeSource = createFamily(rustCompileTimeSourceKey, parent?.compileTimeSource);
  const sourceCallableReturn = createFamily(rustSourceCallableReturnFactKey, parent?.sourceCallableReturn);
  const errorEffectPlans = createRustErrorEffectsProducer(assertOpen, parent?.errorEffects);
  const sourceErrorEdges = createRustSourceErrorEffectsProducer(assertOpen, parent?.sourceErrorEffects);
  const deferredProducerChannels = createRustDeferredProducerEffectsProducer(assertOpen, requireFoundation, parent?.deferredProducerEffects);
  const awaitSourceErrors = createRustAwaitSourceErrorEffectsProducer(assertOpen, parent?.awaitSourceErrorEffects);
  const objectLiteralMethodAdapters = createRustObjectLiteralMethodAdapterProducer(assertOpen, parent?.objectLiteralMethodAdapter);
  const fallibleSubjects = createRustFallibleProducer(assertOpen, parent?.fallible);
  const sourceCallEffectPlans = createRustSourceCallEffectsProducer(assertOpen, parent?.sourceCallEffects);
  const sourceAccessorEffectPlans = createRustSourceAccessorEffectsProducer(assertOpen, parent?.sourceAccessorEffects);
  const futureValues = createRustFutureValueProducer(assertOpen, requireFoundation, definitions, parent?.futureValue);
  const optionProjection = createFamily(rustOptionProjectionFactKey, parent?.optionProjection);
  const flowReadProjection = createFamily(rustFlowReadProjectionFactKey, parent?.flowReadProjection);
  const contextualValueConversion = createFamily(rustContextualValueConversionFactKey, parent?.contextualValueConversion,
    fact => maximumRustFoundation(rustFoundationForContextualConversion(fact.conversion, definitions),
      maximumRustFoundation(rustFoundationForCarrier(fact.sourceCarrier), rustFoundationForCarrier(fact.targetCarrier))));
  const callScopedLifetimeReconciliation = createFamily(rustCallScopedLifetimeReconciliationFactKey, parent?.callScopedLifetimeReconciliation);
  const projectUpcast = createFamily(rustProjectUpcastFactKey, parent?.projectUpcast);
  const projectDowncast = createFamily(rustProjectDowncastFactKey, parent?.projectDowncast);
  const sourceBinding = createFamily(rustSourceBindingFactKey, parent?.sourceBinding);
  const bindingProjection = createFamily(rustBindingProjectionFactKey, parent?.bindingProjection);
  const mutatedBinding = createFamily(rustMutatedBindingFactKey, parent?.mutatedBinding);
  const mutatedReferent = createFamily(rustMutatedReferentFactKey, parent?.mutatedReferent);
  const selfMode = createFamily(rustSelfModeFactKey, parent?.selfMode);
  const targetOperations = createRustTargetOperationProducer(assertOpen, requireFoundation, definitions, parent?.targetOperation);
  const compoundWrite = createFamily(rustCompoundWriteFactKey, parent?.compoundWrite);
  const computedMember = createFamily(rustComputedMemberFactKey, parent?.computedMember);
  const receiverIndependentMethods = createRustReceiverIndependentMethodProducer(assertOpen, parent?.receiverIndependentMethod);
  const preparedOperationResult = createFamily(rustPreparedOperationResultFactKey, parent?.preparedOperationResult);
  const optionalChain = createFamily(rustOptionalChainFactKey, parent?.optionalChain);
  const typedLocationPlan = createFamily(rustTypedLocationPlanKey, parent?.typedLocationPlan);
  const bindingStorage = createFamily(rustBindingStorageFactKey, parent?.bindingStorage);
  const closureCapture = createFamily(rustClosureCaptureFactKey, parent?.closureCapture);
  const sourceCallableValue = createFamily(rustSourceCallableValueFactKey, parent?.sourceCallableValue);
  const directCallableReference = createFamily(rustDirectCallableReferenceFactKey, parent?.directCallableReference);
  const moduleBinding = createFamily(rustModuleBindingFactKey, parent?.moduleBinding);
  const typeOnlyDeclaration = createFamily(rustTypeOnlyDeclarationFactKey, parent?.typeOnlyDeclaration);
  const nativeArrays = createRustNativeArrayStorageProducer(assertOpen, parent?.nativeArrayStorage);
  const nativeBackings = createRustNativeBackingProducer(assertOpen, parent?.nativeBacking);
  const rawLocations = createRustRawLocationProducer(assertOpen, parent?.rawLocationPlan);
  const indexedFieldKeyArgument = createFamily(rustIndexedFieldKeyArgument, parent?.indexedFieldKeyArgument);
  const objectReferenceViews = createRustObjectReferenceViewProducer(assertOpen, parent?.objectReferenceView);
  const projectCallableAdapterPlans = createRustProjectCallableAdapterProducer(assertOpen, parent?.projectCallableAdapters);
  const retainedEnvironment = createFamily(rustRetainedEnvironmentFactKey, parent?.retainedEnvironment);
  const retainedCallLifetimes = createFamily(rustRetainedCallLifetimesFactKey, parent?.retainedCallLifetimes);
  const genericNumericOperands = createFamily(rustGenericNumericOperandsKey, parent?.genericNumericOperands);
  const moduleCallableStorage = createFamily(rustModuleCallableStorageFactKey, parent?.moduleCallableStorage);
  const genericCallableInvocations = createRustGenericCallableInvocationProducer(assertOpen, parent?.genericCallableInvocation);
  const capturedFieldStorage = createFamily(rustCapturedFieldStorageFactKey, parent?.capturedFieldStorage);
  const propertyProjection = createFamily(rustPropertyProjectionFactKey, parent?.propertyProjection);
  const memoryBindings = createRustMemoryBindingProducer(assertOpen, parent?.memoryBindingPlan);
  const rawAddresses = createRustRawAddressProducer(assertOpen, parent?.rawAddressPlan);
  const memoryLayoutObservation = createFamily(rustMemoryLayoutObservationKey, parent?.memoryLayoutObservation);
  const classValues = createRustClassValueProducer(assertOpen, parent?.classValue);

  const records: RustProgramRecords = Object.freeze({
    typeAliasDeclaration: typeAliasDeclaration.reader,
    asyncFunction: asyncFunction.reader,
    generator: generator.reader,
    yield: yielded.reader,
    resourceManagement: resourceManagementPlans.records,
    sourceParameterAbi: sourceParameterAbi.reader,
    runtimeCarrier: runtimeCarriers.records,
    selectedCall: selectedCalls.records,
    selectedOperation: selectedOperations.records,
    conversion: conversion.reader,
    argumentPassing: argumentPassing.reader,
    nativeGuardResult: nativeGuardResult.reader,
    nativeUnreachable: nativeUnreachable.reader,
    awaitValue: awaitValues.records,
    compileTimeSource: compileTimeSource.reader,
    sourceCallableReturn: sourceCallableReturn.reader,
    errorEffects: errorEffectPlans.records,
    sourceErrorEffects: sourceErrorEdges.records,
    deferredProducerEffects: deferredProducerChannels.records,
    awaitSourceErrorEffects: awaitSourceErrors.records,
    objectLiteralMethodAdapter: objectLiteralMethodAdapters.records,
    fallible: fallibleSubjects.records,
    sourceCallEffects: sourceCallEffectPlans.records,
    sourceAccessorEffects: sourceAccessorEffectPlans.records,
    futureValue: futureValues.records,
    optionProjection: optionProjection.reader,
    flowReadProjection: flowReadProjection.reader,
    contextualValueConversion: contextualValueConversion.reader,
    callScopedLifetimeReconciliation: callScopedLifetimeReconciliation.reader,
    projectUpcast: projectUpcast.reader,
    projectDowncast: projectDowncast.reader,
    sourceBinding: sourceBinding.reader,
    bindingProjection: bindingProjection.reader,
    mutatedBinding: mutatedBinding.reader,
    mutatedReferent: mutatedReferent.reader,
    selfMode: selfMode.reader,
    targetOperation: targetOperations.records,
    compoundWrite: compoundWrite.reader,
    computedMember: computedMember.reader,
    receiverIndependentMethod: receiverIndependentMethods.records,
    preparedOperationResult: preparedOperationResult.reader,
    optionalChain: optionalChain.reader,
    typedLocationPlan: typedLocationPlan.reader,
    bindingStorage: bindingStorage.reader,
    closureCapture: closureCapture.reader,
    sourceCallableValue: sourceCallableValue.reader,
    directCallableReference: directCallableReference.reader,
    moduleBinding: moduleBinding.reader,
    typeOnlyDeclaration: typeOnlyDeclaration.reader,
    nativeArrayStorage: nativeArrays.records,
    nativeBacking: nativeBackings.records,
    rawLocationPlan: rawLocations.records,
    indexedFieldKeyArgument: indexedFieldKeyArgument.reader,
    objectReferenceView: objectReferenceViews.records,
    projectCallableAdapters: projectCallableAdapterPlans.records,
    retainedEnvironment: retainedEnvironment.reader,
    retainedCallLifetimes: retainedCallLifetimes.reader,
    genericNumericOperands: genericNumericOperands.reader,
    moduleCallableStorage: moduleCallableStorage.reader,
    genericCallableInvocation: genericCallableInvocations.records,
    capturedFieldStorage: capturedFieldStorage.reader,
    propertyProjection: propertyProjection.reader,
    memoryBindingPlan: memoryBindings.records,
    rawAddressPlan: rawAddresses.records,
    memoryLayoutObservation: memoryLayoutObservation.reader,
    classValue: classValues.records,
  });
  return Object.freeze({
    typeAliasDeclaration: typeAliasDeclaration.writer,
    asyncFunction: asyncFunction.writer,
    generator: generator.writer,
    yield: yielded.writer,
    resourceManagement: resourceManagementPlans.records,
    resourceManagementPlans,
    sourceParameterAbi: sourceParameterAbi.writer,
    runtimeCarrier: runtimeCarriers.records,
    runtimeCarriers,
    selectedCall: selectedCalls.records,
    selectedCalls,
    selectedOperation: selectedOperations.records,
    selectedOperations,
    conversion: conversion.writer,
    argumentPassing: argumentPassing.writer,
    nativeGuardResult: nativeGuardResult.writer,
    nativeUnreachable: nativeUnreachable.writer,
    awaitValue: awaitValues.records,
    awaitValues,
    compileTimeSource: compileTimeSource.writer,
    sourceCallableReturn: sourceCallableReturn.writer,
    errorEffects: errorEffectPlans.records,
    errorEffectPlans,
    sourceErrorEffects: sourceErrorEdges.records,
    sourceErrorEdges,
    deferredProducerEffects: deferredProducerChannels.records,
    deferredProducerChannels,
    awaitSourceErrorEffects: awaitSourceErrors.records,
    awaitSourceErrors,
    objectLiteralMethodAdapter: objectLiteralMethodAdapters.records,
    objectLiteralMethodAdapters,
    fallible: fallibleSubjects.records,
    fallibleSubjects,
    sourceCallEffects: sourceCallEffectPlans.records,
    sourceCallEffectPlans,
    sourceAccessorEffects: sourceAccessorEffectPlans.records,
    sourceAccessorEffectPlans,
    futureValue: futureValues.records,
    futureValues,
    optionProjection: optionProjection.writer,
    flowReadProjection: flowReadProjection.writer,
    contextualValueConversion: contextualValueConversion.writer,
    callScopedLifetimeReconciliation: callScopedLifetimeReconciliation.writer,
    projectUpcast: projectUpcast.writer,
    projectDowncast: projectDowncast.writer,
    sourceBinding: sourceBinding.writer,
    bindingProjection: bindingProjection.writer,
    mutatedBinding: mutatedBinding.writer,
    mutatedReferent: mutatedReferent.writer,
    selfMode: selfMode.writer,
    targetOperation: targetOperations.records,
    targetOperations,
    compoundWrite: compoundWrite.writer,
    computedMember: computedMember.writer,
    receiverIndependentMethod: receiverIndependentMethods.records,
    receiverIndependentMethods,
    preparedOperationResult: preparedOperationResult.writer,
    optionalChain: optionalChain.writer,
    typedLocationPlan: typedLocationPlan.writer,
    bindingStorage: bindingStorage.writer,
    closureCapture: closureCapture.writer,
    sourceCallableValue: sourceCallableValue.writer,
    directCallableReference: directCallableReference.writer,
    moduleBinding: moduleBinding.writer,
    typeOnlyDeclaration: typeOnlyDeclaration.writer,
    nativeArrayStorage: nativeArrays.records,
    nativeArrays,
    nativeBacking: nativeBackings.records,
    nativeBackings,
    rawLocationPlan: rawLocations.records,
    rawLocations,
    indexedFieldKeyArgument: indexedFieldKeyArgument.writer,
    objectReferenceView: objectReferenceViews.records,
    objectReferenceViews,
    projectCallableAdapters: projectCallableAdapterPlans.records,
    projectCallableAdapterPlans,
    retainedEnvironment: retainedEnvironment.writer,
    retainedCallLifetimes: retainedCallLifetimes.writer,
    genericNumericOperands: genericNumericOperands.writer,
    moduleCallableStorage: moduleCallableStorage.writer,
    genericCallableInvocation: genericCallableInvocations.records,
    genericCallableInvocations,
    capturedFieldStorage: capturedFieldStorage.writer,
    propertyProjection: propertyProjection.writer,
    memoryBindingPlan: memoryBindings.records,
    memoryBindings,
    rawAddressPlan: rawAddresses.records,
    rawAddresses,
    memoryLayoutObservation: memoryLayoutObservation.writer,
    classValue: classValues.records,
    classValues,
    minimumFoundation(): RustFoundation {
      return maximumRustFoundation(minimumFoundation, selectedOperations.minimumFoundation());
    },
    seal(): RustProgramRecords {
      if (sealed) throw new Error("Rust semantic plans can be sealed only once.");
      selectedOperations.seal();
      sealed = true;
      return records;
    },
  });
}
