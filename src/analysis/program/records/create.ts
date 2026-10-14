import type { RustPlanKey } from "./key.js";
import type { RustProgramRecordBuilder } from "./model.js";
import { createRustRecordFamily } from "./family.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";
import { rustFoundationForCarrier } from "../../foundation/requirements.js";
import { rustFoundationForContextualConversion, rustFoundationForFinalizedConversion, rustFoundationForValueConversion } from "../../foundation/conversion-requirements.js";
import { rustAwaitSelectionLeaves } from "../../../target-model/types/await.js";
import { rustTypeAliasDeclarationFactKey, rustAsyncFunctionFactKey, rustGeneratorFactKey, rustYieldFactKey, rustResourceManagementFactKey, rustSourceParameterAbiFactKey } from "./keys/callables-and-resources.js";
import { rustConversionKey, rustArgumentPassingKey } from "./keys/selections.js";
import { createRustSelectedOperationProducer } from "./selected-operation.js";
import { createRustRuntimeCarrierProducer } from "./runtime-carrier.js";
import { createRustSelectedCallProducer } from "./selected-call.js";
import { createRustTargetOperationProducer } from "./target-operation.js";
import { rustNativeGuardResultFactKey, rustNativeUnreachableFactKey } from "./keys/native-control-flow.js";
import { rustAwaitValueFactKey } from "./keys/await-values.js";
import { rustCompileTimeSourceKey, rustSourceCallableReturnFactKey } from "./keys/source-declarations.js";
import { rustErrorEffectsFactKey } from "./keys/error-effects.js";
import { rustSourceErrorEffectsFactKey } from "./keys/source-error-effects.js";
import { rustDeferredProducerEffectsFactKey } from "./keys/deferred-producer-effects.js";
import { rustAwaitSourceErrorEffectsFactKey } from "./keys/await-source-error-effects.js";
import { rustObjectLiteralMethodAdapterFactKey, rustFallibleFactKey, rustSourceCallEffectsFactKey, rustSourceAccessorEffectsFactKey, rustFutureValueFactKey } from "./keys/object-methods.js";
import { rustOptionProjectionFactKey, rustFlowReadProjectionFactKey, rustContextualValueConversionFactKey, rustCallScopedLifetimeReconciliationFactKey, rustProjectUpcastFactKey, rustProjectDowncastFactKey, rustSourceBindingFactKey, rustBindingProjectionFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustSelfModeFactKey } from "./keys/value-projections.js";
import { rustCompoundWriteFactKey, rustComputedMemberFactKey, rustReceiverIndependentMethodFactKey, rustPreparedOperationResultFactKey, rustOptionalChainFactKey, rustTypedLocationPlanKey, rustBindingStorageFactKey, rustClosureCaptureFactKey, rustSourceCallableValueFactKey, rustDirectCallableReferenceFactKey, rustModuleBindingFactKey } from "./keys/operation-selections.js";
import { rustTypeOnlyDeclarationFactKey } from "./keys/type-only.js";
import { createRustNativeArrayStorageProducer } from "./native-array-storage.js";
import { createRustNativeBackingProducer } from "./native-backing.js";
import { createRustRawLocationProducer } from "./raw-locations.js";
import { rustIndexedFieldKeyArgument } from "./keys/indexed-field-keys.js";
import { rustObjectReferenceViewKey } from "./keys/object-reference-views.js";
import { rustProjectCallableAdaptersKey } from "./keys/project-callable-adapters.js";
import { rustRetainedEnvironmentFactKey, rustRetainedCallLifetimesFactKey } from "./keys/retained-environments.js";
import { rustGenericNumericOperandsKey } from "./keys/generic-numeric.js";
import { rustModuleCallableStorageFactKey } from "./keys/module-values.js";
import { rustGenericCallableInvocationFactKey } from "./keys/generic-callable-effects.js";
import { rustCapturedFieldStorageFactKey } from "./keys/receiver-captures.js";
import { rustPropertyProjectionFactKey } from "./keys/property-projections.js";
import { createRustMemoryBindingProducer } from "./memory-bindings.js";
import { createRustRawAddressProducer } from "./raw-addresses.js";
import { rustMemoryLayoutObservationKey } from "./keys/memory-layout.js";
import { rustClassValueFactKey } from "./keys/class-values.js";

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
  const resourceManagement = createFamily(rustResourceManagementFactKey, parent?.resourceManagement);
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
  const awaitValue = createFamily(rustAwaitValueFactKey, parent?.awaitValue, fact => {
    let foundation: RustFoundation = "core";
    for (const leaf of rustAwaitSelectionLeaves(fact.selection)) {
      if (leaf.completion.kind === "value") foundation = maximumRustFoundation(foundation,
        rustFoundationForFinalizedConversion(leaf.completion.conversion, definitions));
    }
    return foundation;
  });
  const compileTimeSource = createFamily(rustCompileTimeSourceKey, parent?.compileTimeSource);
  const sourceCallableReturn = createFamily(rustSourceCallableReturnFactKey, parent?.sourceCallableReturn);
  const errorEffects = createFamily(rustErrorEffectsFactKey, parent?.errorEffects);
  const sourceErrorEffects = createFamily(rustSourceErrorEffectsFactKey, parent?.sourceErrorEffects);
  const deferredProducerEffects = createFamily(rustDeferredProducerEffectsFactKey, parent?.deferredProducerEffects,
    fact => fact.kind === "no-future" ? "core" : fact.channels.reduce<RustFoundation>((foundation, channel) =>
      maximumRustFoundation(foundation, rustFoundationForCarrier(channel.errorCarrier)), "core"));
  const awaitSourceErrorEffects = createFamily(rustAwaitSourceErrorEffectsFactKey, parent?.awaitSourceErrorEffects);
  const objectLiteralMethodAdapter = createFamily(rustObjectLiteralMethodAdapterFactKey, parent?.objectLiteralMethodAdapter);
  const fallible = createFamily(rustFallibleFactKey, parent?.fallible);
  const sourceCallEffects = createFamily(rustSourceCallEffectsFactKey, parent?.sourceCallEffects);
  const sourceAccessorEffects = createFamily(rustSourceAccessorEffectsFactKey, parent?.sourceAccessorEffects);
  const futureValue = createFamily(rustFutureValueFactKey, parent?.futureValue, fact => {
    const conversion = rustFoundationForFinalizedConversion(fact.awaitedConversion, definitions);
    return fact.errorCarrier === undefined ? conversion : maximumRustFoundation(conversion,
      rustFoundationForCarrier(fact.errorCarrier));
  });
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
  const receiverIndependentMethod = createFamily(rustReceiverIndependentMethodFactKey, parent?.receiverIndependentMethod);
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
  const objectReferenceView = createFamily(rustObjectReferenceViewKey, parent?.objectReferenceView);
  const projectCallableAdapters = createFamily(rustProjectCallableAdaptersKey, parent?.projectCallableAdapters);
  const retainedEnvironment = createFamily(rustRetainedEnvironmentFactKey, parent?.retainedEnvironment);
  const retainedCallLifetimes = createFamily(rustRetainedCallLifetimesFactKey, parent?.retainedCallLifetimes);
  const genericNumericOperands = createFamily(rustGenericNumericOperandsKey, parent?.genericNumericOperands);
  const moduleCallableStorage = createFamily(rustModuleCallableStorageFactKey, parent?.moduleCallableStorage);
  const genericCallableInvocation = createFamily(rustGenericCallableInvocationFactKey, parent?.genericCallableInvocation);
  const capturedFieldStorage = createFamily(rustCapturedFieldStorageFactKey, parent?.capturedFieldStorage);
  const propertyProjection = createFamily(rustPropertyProjectionFactKey, parent?.propertyProjection);
  const memoryBindings = createRustMemoryBindingProducer(assertOpen, parent?.memoryBindingPlan);
  const rawAddresses = createRustRawAddressProducer(assertOpen, parent?.rawAddressPlan);
  const memoryLayoutObservation = createFamily(rustMemoryLayoutObservationKey, parent?.memoryLayoutObservation);
  const classValue = createFamily(rustClassValueFactKey, parent?.classValue);

  const records: RustProgramRecords = Object.freeze({
    typeAliasDeclaration: typeAliasDeclaration.reader,
    asyncFunction: asyncFunction.reader,
    generator: generator.reader,
    yield: yielded.reader,
    resourceManagement: resourceManagement.reader,
    sourceParameterAbi: sourceParameterAbi.reader,
    runtimeCarrier: runtimeCarriers.records,
    selectedCall: selectedCalls.records,
    selectedOperation: selectedOperations.records,
    conversion: conversion.reader,
    argumentPassing: argumentPassing.reader,
    nativeGuardResult: nativeGuardResult.reader,
    nativeUnreachable: nativeUnreachable.reader,
    awaitValue: awaitValue.reader,
    compileTimeSource: compileTimeSource.reader,
    sourceCallableReturn: sourceCallableReturn.reader,
    errorEffects: errorEffects.reader,
    sourceErrorEffects: sourceErrorEffects.reader,
    deferredProducerEffects: deferredProducerEffects.reader,
    awaitSourceErrorEffects: awaitSourceErrorEffects.reader,
    objectLiteralMethodAdapter: objectLiteralMethodAdapter.reader,
    fallible: fallible.reader,
    sourceCallEffects: sourceCallEffects.reader,
    sourceAccessorEffects: sourceAccessorEffects.reader,
    futureValue: futureValue.reader,
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
    receiverIndependentMethod: receiverIndependentMethod.reader,
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
    objectReferenceView: objectReferenceView.reader,
    projectCallableAdapters: projectCallableAdapters.reader,
    retainedEnvironment: retainedEnvironment.reader,
    retainedCallLifetimes: retainedCallLifetimes.reader,
    genericNumericOperands: genericNumericOperands.reader,
    moduleCallableStorage: moduleCallableStorage.reader,
    genericCallableInvocation: genericCallableInvocation.reader,
    capturedFieldStorage: capturedFieldStorage.reader,
    propertyProjection: propertyProjection.reader,
    memoryBindingPlan: memoryBindings.records,
    rawAddressPlan: rawAddresses.records,
    memoryLayoutObservation: memoryLayoutObservation.reader,
    classValue: classValue.reader,
  });
  return Object.freeze({
    typeAliasDeclaration: typeAliasDeclaration.writer,
    asyncFunction: asyncFunction.writer,
    generator: generator.writer,
    yield: yielded.writer,
    resourceManagement: resourceManagement.writer,
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
    awaitValue: awaitValue.writer,
    compileTimeSource: compileTimeSource.writer,
    sourceCallableReturn: sourceCallableReturn.writer,
    errorEffects: errorEffects.writer,
    sourceErrorEffects: sourceErrorEffects.writer,
    deferredProducerEffects: deferredProducerEffects.writer,
    awaitSourceErrorEffects: awaitSourceErrorEffects.writer,
    objectLiteralMethodAdapter: objectLiteralMethodAdapter.writer,
    fallible: fallible.writer,
    sourceCallEffects: sourceCallEffects.writer,
    sourceAccessorEffects: sourceAccessorEffects.writer,
    futureValue: futureValue.writer,
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
    receiverIndependentMethod: receiverIndependentMethod.writer,
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
    objectReferenceView: objectReferenceView.writer,
    projectCallableAdapters: projectCallableAdapters.writer,
    retainedEnvironment: retainedEnvironment.writer,
    retainedCallLifetimes: retainedCallLifetimes.writer,
    genericNumericOperands: genericNumericOperands.writer,
    moduleCallableStorage: moduleCallableStorage.writer,
    genericCallableInvocation: genericCallableInvocation.writer,
    capturedFieldStorage: capturedFieldStorage.writer,
    propertyProjection: propertyProjection.writer,
    memoryBindingPlan: memoryBindings.records,
    memoryBindings,
    rawAddressPlan: rawAddresses.records,
    rawAddresses,
    memoryLayoutObservation: memoryLayoutObservation.writer,
    classValue: classValue.writer,
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
