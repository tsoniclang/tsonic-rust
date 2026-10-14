import type { RustPlanKey } from "./key.js";
import type { RustProgramRecordBuilder } from "./model.js";
import { createRustRecordFamily } from "./family.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";
import { rustFoundationForCarrier } from "../../foundation/requirements.js";
import { rustFoundationForContextualConversion } from "../../foundation/conversion-requirements.js";
import { createRustGeneratorProducer } from "./generator.js";
import { createRustSourceParameterAbiProducer } from "./source-parameter-abi.js";
import { createRustSourceBindingProducer } from "./source-binding.js";
import { createRustAsyncFunctionProducer } from "./async-function.js";
import { createRustYieldProducer } from "./yield.js";
import { createRustComputedMemberProducer } from "./computed-member.js";
import { createRustCompoundWriteProducer } from "./compound-write.js";
import { createRustArgumentPassingProducer } from "./argument-passing.js";
import { createRustBindingStorageProducer } from "./binding-storage.js";
import { createRustRetainedCallLifetimesProducer } from "./retained-call-lifetimes.js";
import { createRustBindingProjectionProducer } from "./binding-projection.js";
import { createRustTypedLocationProducer } from "./typed-location-plan.js";
import { rustConversionKey } from "./keys/selections.js";
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
import { createRustNativeGuardResultProducer } from "./native-guard-result.js";
import { createRustNativeUnreachableProducer } from "./native-unreachable.js";
import { createRustGenericNumericOperandsProducer } from "./generic-numeric-operands.js";
import { createRustIndexedFieldKeyArgumentProducer } from "./indexed-field-key-argument.js";
import { createRustPropertyProjectionProducer } from "./property-projection.js";
import { createRustCallScopedLifetimeReconciliationProducer } from "./call-scoped-lifetime-reconciliation.js";
import { createRustProjectUpcastProducer } from "./project-upcast.js";
import { createRustProjectDowncastProducer } from "./project-downcast.js";
import { createRustCompileTimeSourceProducer } from "./compile-time-source.js";
import { createRustSelfModeProducer } from "./self-mode.js";
import { rustOptionProjectionFactKey, rustFlowReadProjectionFactKey, rustContextualValueConversionFactKey } from "./keys/value-projections.js";
import { rustPreparedOperationResultFactKey, rustOptionalChainFactKey, rustClosureCaptureFactKey } from "./keys/operation-selections.js";
import { createRustNativeArrayStorageProducer } from "./native-array-storage.js";
import { createRustNativeBackingProducer } from "./native-backing.js";
import { createRustRawLocationProducer } from "./raw-locations.js";
import { createRustSourceCallableValueProducer } from "./source-callable-value.js";
import { createRustDirectCallableReferenceProducer } from "./direct-callable-reference.js";
import { createRustRetainedEnvironmentProducer } from "./retained-environment.js";
import { createRustMemoryBindingProducer } from "./memory-bindings.js";
import { createRustRawAddressProducer } from "./raw-addresses.js";
import { createRustTypeOnlyDeclarationProducer } from "./type-only-declaration.js";
import { createRustModuleBindingProducer } from "./module-binding.js";
import { createRustModuleCallableStorageProducer } from "./module-callable-storage.js";
import { createRustSourceCallableReturnProducer } from "./source-callable-return.js";
import { createRustCapturedFieldStorageProducer } from "./captured-field-storage.js";
import { createRustTypeAliasDeclarationProducer } from "./type-alias-declaration.js";
import { createRustMutatedBindingProducer } from "./mutated-binding.js";
import { createRustMutatedReferentProducer } from "./mutated-referent.js";
import { createRustMemoryLayoutObservationProducer } from "./memory-layout-observation.js";

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

  const typeAliasDeclarations = createRustTypeAliasDeclarationProducer(assertOpen, parent?.typeAliasDeclaration);
  const asyncFunctions = createRustAsyncFunctionProducer(assertOpen, parent?.asyncFunction);
  const generators = createRustGeneratorProducer(assertOpen, parent?.generator);
  const yields = createRustYieldProducer(assertOpen, parent?.yield);
  const resourceManagementPlans = createRustResourceManagementProducer(assertOpen, parent?.resourceManagement);
  const sourceParameterAbis = createRustSourceParameterAbiProducer(assertOpen, requireFoundation, definitions, parent?.sourceParameterAbi);
  const runtimeCarriers = createRustRuntimeCarrierProducer(assertOpen, requireFoundation, parent?.runtimeCarrier);
  const selectedCalls = createRustSelectedCallProducer(assertOpen, requireFoundation, parent?.selectedCall);
  const selectedOperations = createRustSelectedOperationProducer(parent?.selectedOperation);
  const conversion = createFamily(rustConversionKey, parent?.conversion,
    value => value.convertedType === undefined ? "core" : rustFoundationForCarrier(value.convertedType));
  const argumentPassingPlans = createRustArgumentPassingProducer(assertOpen, parent?.argumentPassing);
  const nativeGuardResults = createRustNativeGuardResultProducer(assertOpen, parent?.nativeGuardResult);
  const nativeUnreachableNodes = createRustNativeUnreachableProducer(assertOpen, parent?.nativeUnreachable);
  const awaitValues = createRustAwaitValueProducer(assertOpen, requireFoundation, definitions, parent?.awaitValue);
  const compileTimeSources = createRustCompileTimeSourceProducer(assertOpen, parent?.compileTimeSource);
  const sourceCallableReturns = createRustSourceCallableReturnProducer(assertOpen, parent?.sourceCallableReturn);
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
  const callScopedLifetimes = createRustCallScopedLifetimeReconciliationProducer(assertOpen, parent?.callScopedLifetimeReconciliation);
  const projectUpcasts = createRustProjectUpcastProducer(assertOpen, parent?.projectUpcast);
  const projectDowncasts = createRustProjectDowncastProducer(assertOpen, parent?.projectDowncast);
  const sourceBindings = createRustSourceBindingProducer(assertOpen, parent?.sourceBinding);
  const bindingProjections = createRustBindingProjectionProducer(assertOpen, parent?.bindingProjection);
  const mutatedBindings = createRustMutatedBindingProducer(assertOpen, parent?.mutatedBinding);
  const mutatedReferents = createRustMutatedReferentProducer(assertOpen, parent?.mutatedReferent);
  const selfModes = createRustSelfModeProducer(assertOpen, parent?.selfMode);
  const targetOperations = createRustTargetOperationProducer(assertOpen, requireFoundation, definitions, parent?.targetOperation);
  const compoundWrites = createRustCompoundWriteProducer(assertOpen, parent?.compoundWrite);
  const computedMembers = createRustComputedMemberProducer(assertOpen, parent?.computedMember);
  const receiverIndependentMethods = createRustReceiverIndependentMethodProducer(assertOpen, parent?.receiverIndependentMethod);
  const preparedOperationResult = createFamily(rustPreparedOperationResultFactKey, parent?.preparedOperationResult);
  const optionalChain = createFamily(rustOptionalChainFactKey, parent?.optionalChain);
  const typedLocations = createRustTypedLocationProducer(assertOpen, parent?.typedLocationPlan);
  const bindingStoragePlans = createRustBindingStorageProducer(assertOpen, parent?.bindingStorage);
  const closureCapture = createFamily(rustClosureCaptureFactKey, parent?.closureCapture);
  const sourceCallableValues = createRustSourceCallableValueProducer(assertOpen, parent?.sourceCallableValue);
  const directCallableReferences = createRustDirectCallableReferenceProducer(assertOpen, parent?.directCallableReference);
  const moduleBindings = createRustModuleBindingProducer(assertOpen, parent?.moduleBinding);
  const typeOnlyDeclarations = createRustTypeOnlyDeclarationProducer(assertOpen, parent?.typeOnlyDeclaration);
  const nativeArrays = createRustNativeArrayStorageProducer(assertOpen, parent?.nativeArrayStorage);
  const nativeBackings = createRustNativeBackingProducer(assertOpen, parent?.nativeBacking);
  const rawLocations = createRustRawLocationProducer(assertOpen, parent?.rawLocationPlan);
  const indexedFieldKeys = createRustIndexedFieldKeyArgumentProducer(assertOpen, parent?.indexedFieldKeyArgument);
  const objectReferenceViews = createRustObjectReferenceViewProducer(assertOpen, parent?.objectReferenceView);
  const projectCallableAdapterPlans = createRustProjectCallableAdapterProducer(assertOpen, parent?.projectCallableAdapters);
  const retainedEnvironments = createRustRetainedEnvironmentProducer(assertOpen, parent?.retainedEnvironment);
  const retainedCalls = createRustRetainedCallLifetimesProducer(assertOpen, parent?.retainedCallLifetimes);
  const genericNumerics = createRustGenericNumericOperandsProducer(assertOpen, parent?.genericNumericOperands);
  const moduleCallableStoragePlans = createRustModuleCallableStorageProducer(assertOpen, parent?.moduleCallableStorage);
  const genericCallableInvocations = createRustGenericCallableInvocationProducer(assertOpen, parent?.genericCallableInvocation);
  const capturedFieldStoragePlans = createRustCapturedFieldStorageProducer(assertOpen, parent?.capturedFieldStorage);
  const propertyProjections = createRustPropertyProjectionProducer(assertOpen, parent?.propertyProjection);
  const memoryBindings = createRustMemoryBindingProducer(assertOpen, parent?.memoryBindingPlan);
  const rawAddresses = createRustRawAddressProducer(assertOpen, parent?.rawAddressPlan);
  const memoryLayoutObservations = createRustMemoryLayoutObservationProducer(assertOpen, parent?.memoryLayoutObservation);
  const classValues = createRustClassValueProducer(assertOpen, parent?.classValue);

  const records: RustProgramRecords = Object.freeze({
    typeAliasDeclaration: typeAliasDeclarations.records,
    asyncFunction: asyncFunctions.records,
    generator: generators.records,
    yield: yields.records,
    resourceManagement: resourceManagementPlans.records,
    sourceParameterAbi: sourceParameterAbis.records,
    runtimeCarrier: runtimeCarriers.records,
    selectedCall: selectedCalls.records,
    selectedOperation: selectedOperations.records,
    conversion: conversion.reader,
    argumentPassing: argumentPassingPlans.records,
    nativeGuardResult: nativeGuardResults.records,
    nativeUnreachable: nativeUnreachableNodes.records,
    awaitValue: awaitValues.records,
    compileTimeSource: compileTimeSources.records,
    sourceCallableReturn: sourceCallableReturns.records,
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
    callScopedLifetimeReconciliation: callScopedLifetimes.records,
    projectUpcast: projectUpcasts.records,
    projectDowncast: projectDowncasts.records,
    sourceBinding: sourceBindings.records,
    bindingProjection: bindingProjections.records,
    mutatedBinding: mutatedBindings.records,
    mutatedReferent: mutatedReferents.records,
    selfMode: selfModes.records,
    targetOperation: targetOperations.records,
    compoundWrite: compoundWrites.records,
    computedMember: computedMembers.records,
    receiverIndependentMethod: receiverIndependentMethods.records,
    preparedOperationResult: preparedOperationResult.reader,
    optionalChain: optionalChain.reader,
    typedLocationPlan: typedLocations.records,
    bindingStorage: bindingStoragePlans.records,
    closureCapture: closureCapture.reader,
    sourceCallableValue: sourceCallableValues.records,
    directCallableReference: directCallableReferences.records,
    moduleBinding: moduleBindings.records,
    typeOnlyDeclaration: typeOnlyDeclarations.records,
    nativeArrayStorage: nativeArrays.records,
    nativeBacking: nativeBackings.records,
    rawLocationPlan: rawLocations.records,
    indexedFieldKeyArgument: indexedFieldKeys.records,
    objectReferenceView: objectReferenceViews.records,
    projectCallableAdapters: projectCallableAdapterPlans.records,
    retainedEnvironment: retainedEnvironments.records,
    retainedCallLifetimes: retainedCalls.records,
    genericNumericOperands: genericNumerics.records,
    moduleCallableStorage: moduleCallableStoragePlans.records,
    genericCallableInvocation: genericCallableInvocations.records,
    capturedFieldStorage: capturedFieldStoragePlans.records,
    propertyProjection: propertyProjections.records,
    memoryBindingPlan: memoryBindings.records,
    rawAddressPlan: rawAddresses.records,
    memoryLayoutObservation: memoryLayoutObservations.records,
    classValue: classValues.records,
  });
  return Object.freeze({
    typeAliasDeclaration: typeAliasDeclarations.records,
    typeAliasDeclarations,
    asyncFunction: asyncFunctions.records,
    asyncFunctions,
    generator: generators.records,
    generators,
    yield: yields.records,
    yields,
    resourceManagement: resourceManagementPlans.records,
    resourceManagementPlans,
    sourceParameterAbi: sourceParameterAbis.records,
    sourceParameterAbis,
    runtimeCarrier: runtimeCarriers.records,
    runtimeCarriers,
    selectedCall: selectedCalls.records,
    selectedCalls,
    selectedOperation: selectedOperations.records,
    selectedOperations,
    conversion: conversion.writer,
    argumentPassing: argumentPassingPlans.records,
    argumentPassingPlans,
    nativeGuardResult: nativeGuardResults.records,
    nativeGuardResults,
    nativeUnreachable: nativeUnreachableNodes.records,
    nativeUnreachableNodes,
    awaitValue: awaitValues.records,
    awaitValues,
    compileTimeSource: compileTimeSources.records,
    compileTimeSources,
    sourceCallableReturn: sourceCallableReturns.records,
    sourceCallableReturns,
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
    callScopedLifetimeReconciliation: callScopedLifetimes.records,
    callScopedLifetimes,
    projectUpcast: projectUpcasts.records,
    projectUpcasts,
    projectDowncast: projectDowncasts.records,
    projectDowncasts,
    sourceBinding: sourceBindings.records,
    sourceBindings,
    bindingProjection: bindingProjections.records,
    bindingProjections,
    mutatedBinding: mutatedBindings.records,
    mutatedBindings,
    mutatedReferent: mutatedReferents.records,
    mutatedReferents,
    selfMode: selfModes.records,
    selfModes,
    targetOperation: targetOperations.records,
    targetOperations,
    compoundWrite: compoundWrites.records,
    compoundWrites,
    computedMember: computedMembers.records,
    computedMembers,
    receiverIndependentMethod: receiverIndependentMethods.records,
    receiverIndependentMethods,
    preparedOperationResult: preparedOperationResult.writer,
    optionalChain: optionalChain.writer,
    typedLocationPlan: typedLocations.records,
    typedLocations,
    bindingStorage: bindingStoragePlans.records,
    bindingStoragePlans,
    closureCapture: closureCapture.writer,
    sourceCallableValue: sourceCallableValues.records,
    sourceCallableValues,
    directCallableReference: directCallableReferences.records,
    directCallableReferences,
    moduleBinding: moduleBindings.records,
    moduleBindings,
    typeOnlyDeclaration: typeOnlyDeclarations.records,
    typeOnlyDeclarations,
    nativeArrayStorage: nativeArrays.records,
    nativeArrays,
    nativeBacking: nativeBackings.records,
    nativeBackings,
    rawLocationPlan: rawLocations.records,
    rawLocations,
    indexedFieldKeyArgument: indexedFieldKeys.records,
    indexedFieldKeys,
    objectReferenceView: objectReferenceViews.records,
    objectReferenceViews,
    projectCallableAdapters: projectCallableAdapterPlans.records,
    projectCallableAdapterPlans,
    retainedEnvironment: retainedEnvironments.records,
    retainedEnvironments,
    retainedCallLifetimes: retainedCalls.records,
    retainedCalls,
    genericNumericOperands: genericNumerics.records,
    genericNumerics,
    moduleCallableStorage: moduleCallableStoragePlans.records,
    moduleCallableStoragePlans,
    genericCallableInvocation: genericCallableInvocations.records,
    genericCallableInvocations,
    capturedFieldStorage: capturedFieldStoragePlans.records,
    capturedFieldStoragePlans,
    propertyProjection: propertyProjections.records,
    propertyProjections,
    memoryBindingPlan: memoryBindings.records,
    memoryBindings,
    rawAddressPlan: rawAddresses.records,
    rawAddresses,
    memoryLayoutObservation: memoryLayoutObservations.records,
    memoryLayoutObservations,
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
