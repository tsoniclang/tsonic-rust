import type { RustAnalysisRecords } from "../../../target-model/records/analysis.js";

import { type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { type RustFoundation } from "../../../target-model/foundation/model.js";
import { createRustConversionProducer } from "./conversion.js";

import { createRustOptionProjectionProducer } from "./option-projection.js";
import { createRustFlowReadProjectionProducer } from "./flow-read-projection.js";
import { createRustContextualValueConversionProducer } from "./contextual-value-conversion.js";
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
import { createRustNativeParticipationProducer } from "./native-participation.js";
import { createRustGenericNumericOperandsProducer } from "./generic-numeric-operands.js";
import { createRustIndexedFieldKeyArgumentProducer } from "./indexed-field-key-argument.js";
import { createRustPropertyProjectionProducer } from "./property-projection.js";
import { createRustCallScopedLifetimeReconciliationProducer } from "./call-scoped-lifetime-reconciliation.js";
import { createRustProjectUpcastProducer } from "./project-upcast.js";
import { createRustProjectDowncastProducer } from "./project-downcast.js";
import { createRustCompileTimeSourceProducer } from "./compile-time-source.js";
import { createRustSelfModeProducer } from "./self-mode.js";
import { createRustPreparedOperationResultProducer } from "./prepared-operation-result.js";
import { createRustOptionalChainProducer } from "./optional-chain.js";
import { createRustClosureCaptureProducer } from "./closure-capture.js";
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
import { createRustNativeHandlerProducer } from "./native-handlers.js";

export function createRustSourceRecordProducers(
  assertOpen: () => void, requireFoundation: (foundation: RustFoundation) => void,
  definitions: RustTypeDefinitions, parent: RustAnalysisRecords | undefined,
) {
  const typeAliasDeclarations = createRustTypeAliasDeclarationProducer(assertOpen, parent?.typeAliasDeclaration);
  const asyncFunctions = createRustAsyncFunctionProducer(assertOpen, parent?.asyncFunction);
  const generators = createRustGeneratorProducer(assertOpen, parent?.generator);
  const yields = createRustYieldProducer(assertOpen, parent?.yield);
  const resourceManagementPlans = createRustResourceManagementProducer(assertOpen, parent?.resourceManagement);
  const sourceParameterAbis = createRustSourceParameterAbiProducer(assertOpen, requireFoundation, definitions, parent?.sourceParameterAbi);
  const runtimeCarriers = createRustRuntimeCarrierProducer(assertOpen, requireFoundation, parent?.runtimeCarrier);
  const selectedCalls = createRustSelectedCallProducer(assertOpen, requireFoundation, parent?.selectedCall);
  const selectedOperations = createRustSelectedOperationProducer(parent?.selectedOperation);
  const conversions = createRustConversionProducer(assertOpen, requireFoundation, parent?.conversion);
  const argumentPassingPlans = createRustArgumentPassingProducer(assertOpen, parent?.argumentPassing);
  const nativeGuardResults = createRustNativeGuardResultProducer(assertOpen, parent?.nativeGuardResult);
  const nativeUnreachableNodes = createRustNativeUnreachableProducer(assertOpen, parent?.nativeUnreachable);
  const nativeParticipations = createRustNativeParticipationProducer(assertOpen, parent?.nativeParticipation);
  const awaitValues = createRustAwaitValueProducer(assertOpen, requireFoundation, definitions, parent?.awaitValue);
  const compileTimeSources = createRustCompileTimeSourceProducer(assertOpen, parent?.compileTimeSource);
  const retainedEnvironments = createRustRetainedEnvironmentProducer(assertOpen, parent?.retainedEnvironment);
  const sourceCallableReturns = createRustSourceCallableReturnProducer(assertOpen, retainedEnvironments, parent?.sourceCallableReturn);
  const errorEffectPlans = createRustErrorEffectsProducer(assertOpen, parent?.errorEffects);
  const sourceErrorEdges = createRustSourceErrorEffectsProducer(assertOpen, parent?.sourceErrorEffects);
  const deferredProducerChannels = createRustDeferredProducerEffectsProducer(assertOpen, requireFoundation, parent?.deferredProducerEffects);
  const awaitSourceErrors = createRustAwaitSourceErrorEffectsProducer(assertOpen, parent?.awaitSourceErrorEffects);
  const objectLiteralMethodAdapters = createRustObjectLiteralMethodAdapterProducer(assertOpen, parent?.objectLiteralMethodAdapter);
  const fallibleSubjects = createRustFallibleProducer(assertOpen, parent?.fallible);
  const sourceCallEffectPlans = createRustSourceCallEffectsProducer(assertOpen, parent?.sourceCallEffects);
  const sourceAccessorEffectPlans = createRustSourceAccessorEffectsProducer(assertOpen, parent?.sourceAccessorEffects);
  const futureValues = createRustFutureValueProducer(assertOpen, requireFoundation, definitions, parent?.futureValue);
  const optionProjections = createRustOptionProjectionProducer(assertOpen, parent?.optionProjection);
  const flowReadProjections = createRustFlowReadProjectionProducer(assertOpen, parent?.flowReadProjection);
  const contextualValueConversions = createRustContextualValueConversionProducer(assertOpen, requireFoundation, definitions, parent?.contextualValueConversion);
  const callScopedLifetimes = createRustCallScopedLifetimeReconciliationProducer(assertOpen, parent?.callScopedLifetimeReconciliation);
  const projectUpcasts = createRustProjectUpcastProducer(assertOpen, parent?.projectUpcast);
  const projectDowncasts = createRustProjectDowncastProducer(assertOpen, parent?.projectDowncast);
  const sourceBindings = createRustSourceBindingProducer(assertOpen, parent?.sourceBinding);
  const bindingProjections = createRustBindingProjectionProducer(assertOpen, parent?.bindingProjection);
  const mutatedBindings = createRustMutatedBindingProducer(assertOpen, parent?.mutatedBinding);
  const mutatedReferents = createRustMutatedReferentProducer(assertOpen, parent?.mutatedReferent, parent?.mutatedReferentBinding);
  const selfModes = createRustSelfModeProducer(assertOpen, parent?.selfMode);
  const targetOperations = createRustTargetOperationProducer(assertOpen, requireFoundation, definitions, parent?.targetOperation);
  const compoundWrites = createRustCompoundWriteProducer(assertOpen, parent?.compoundWrite);
  const computedMembers = createRustComputedMemberProducer(assertOpen, parent?.computedMember);
  const receiverIndependentMethods = createRustReceiverIndependentMethodProducer(assertOpen, parent?.receiverIndependentMethod);
  const preparedOperations = createRustPreparedOperationResultProducer(assertOpen, parent?.preparedOperationResult);
  const optionalChains = createRustOptionalChainProducer(assertOpen, parent?.optionalChain);
  const typedLocations = createRustTypedLocationProducer(assertOpen, parent?.typedLocationPlan);
  const bindingStoragePlans = createRustBindingStorageProducer(assertOpen, parent?.bindingStorage);
  const closureCaptures = createRustClosureCaptureProducer(assertOpen, parent?.closureCapture);
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
  const nativeHandlers = createRustNativeHandlerProducer(assertOpen, parent?.nativeHandler);
  return Object.freeze({
    readers: Object.freeze({
    nativeHandler: nativeHandlers.records,
    typeAliasDeclaration: typeAliasDeclarations.records,
    asyncFunction: asyncFunctions.records,
    generator: generators.records,
    yield: yields.records,
    resourceManagement: resourceManagementPlans.records,
    sourceParameterAbi: sourceParameterAbis.records,
    runtimeCarrier: runtimeCarriers.records,
    selectedCall: selectedCalls.records,
    selectedOperation: selectedOperations.records,
    conversion: conversions.records,
    argumentPassing: argumentPassingPlans.records,
    nativeGuardResult: nativeGuardResults.records,
    nativeUnreachable: nativeUnreachableNodes.records,
    nativeParticipation: nativeParticipations.records,
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
    optionProjection: optionProjections.records,
    flowReadProjection: flowReadProjections.records,
    contextualValueConversion: contextualValueConversions.records,
    callScopedLifetimeReconciliation: callScopedLifetimes.records,
    projectUpcast: projectUpcasts.records,
    projectDowncast: projectDowncasts.records,
    sourceBinding: sourceBindings.records,
    bindingProjection: bindingProjections.records,
    mutatedBinding: mutatedBindings.records,
    mutatedReferent: mutatedReferents.records,
    mutatedReferentBinding: mutatedReferents.mutableBindings,
    selfMode: selfModes.records,
    targetOperation: targetOperations.records,
    compoundWrite: compoundWrites.records,
    computedMember: computedMembers.records,
    receiverIndependentMethod: receiverIndependentMethods.records,
    preparedOperationResult: preparedOperations.records,
    optionalChain: optionalChains.records,
    typedLocationPlan: typedLocations.records,
    bindingStorage: bindingStoragePlans.records,
    closureCapture: closureCaptures.records,
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
    }),
    writers: Object.freeze({
    nativeHandlers,
    typeAliasDeclarations,
    asyncFunctions,
    generators,
    yields,
    resourceManagementPlans,
    sourceParameterAbis,
    runtimeCarriers,
    selectedCalls,
    selectedOperations,
    conversions,
    argumentPassingPlans,
    nativeGuardResults,
    nativeUnreachableNodes,
    nativeParticipations,
    awaitValues,
    compileTimeSources,
    sourceCallableReturns,
    errorEffectPlans,
    sourceErrorEdges,
    deferredProducerChannels,
    awaitSourceErrors,
    objectLiteralMethodAdapters,
    fallibleSubjects,
    sourceCallEffectPlans,
    sourceAccessorEffectPlans,
    futureValues,
    optionProjections,
    flowReadProjections,
    contextualValueConversions,
    callScopedLifetimes,
    projectUpcasts,
    projectDowncasts,
    sourceBindings,
    bindingProjections,
    mutatedBindings,
    mutatedReferents,
    selfModes,
    targetOperations,
    compoundWrites,
    computedMembers,
    receiverIndependentMethods,
    preparedOperations,
    optionalChains,
    typedLocations,
    bindingStoragePlans,
    closureCaptures,
    sourceCallableValues,
    directCallableReferences,
    moduleBindings,
    typeOnlyDeclarations,
    nativeArrays,
    nativeBackings,
    rawLocations,
    indexedFieldKeys,
    objectReferenceViews,
    projectCallableAdapterPlans,
    retainedEnvironments,
    retainedCalls,
    genericNumerics,
    moduleCallableStoragePlans,
    genericCallableInvocations,
    capturedFieldStoragePlans,
    propertyProjections,
    memoryBindings,
    rawAddresses,
    memoryLayoutObservations,
    classValues,
    }),
  });
}
