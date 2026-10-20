import { assertRustRequiredRecords, type RustRequiredRecord } from "./required-records.js";
import type { RustAnalysisRecords, RustProgramRecordBuilder } from "./model.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";
import { createRustConversionProducer } from "./conversion.js";
import { createRustSourcePackageEmissionProducer } from "./source-packages.js";
import { createRustSourceArtifactProducer } from "./artifacts.js";
import { createRustSafetyEmissionProducer } from "./safety-emission.js";
import { createRustArrayLiteralProducer } from "./array-literals.js";
import { createRustSourceBindingEmissionProducer } from "./binding-paths.js";
import { createRustSourceFileEmissionProducer } from "./source-file-emission.js";
import { createRustProviderEvaluationProducer } from "./provider-evaluation.js";
import { createRustErrorTransportEmissionProducer } from "./error-transport.js";
import { createRustDispatchContextEmissionProducer } from "./dispatch-contexts.js";
import { createRustTypeEmissionProducer } from "./type-emission.js";
import { createRustBorrowedInitializerProducer } from "./borrowed-initializers.js";
import { createRustCaptureStorageProducer } from "./capture-storage.js";
import { createRustBindingEmissionProducer } from "./binding-emission.js";
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
import { createRustStatementExitProducer } from "./statement-exits.js";
import { createRustStatementCompletionProducer } from "./statement-completion.js";
import { createRustResourceScopeProducer } from "./resource-scopes.js";
import { createRustLocalBindingProducer } from "./local-bindings.js";
import { createRustFieldProjectionAssignmentProducer } from "./field-projection-assignment.js";
import { createRustAssignmentWriteProducer } from "./assignment-writes.js";
import { createRustBorrowedElementProducer } from "./borrowed-element-reads.js";
import { createRustFieldWriteProducer } from "./field-writes.js";
import { createRustDeclarationEmissionProducer } from "./declaration-emission.js";
import { createRustLexicalValueProducer } from "./lexical-values.js";
import { createRustNativeProtocolProducer } from "./native-protocol-emission.js";
import { createRustErrorEmissionProducer } from "./error-emission.js";
import { createRustClassInitializationProducer } from "./class-initialization.js";
import { createRustCallableParameterProducer } from "./parameter-emission.js";
import { createRustGenericEmissionProducer } from "./generic-emission.js";
import { createRustLexicalFunctionProducer } from "./lexical-functions.js";
import { createRustCallableDeclarationProducer } from "./callable-emission.js";
import { createRustMethodEmissionProducer } from "./method-emission.js";
import { createRustFrameEmissionProducer } from "./frame-emission.js";
import { createRustSuspendedCallableProducer } from "./suspended-callables.js";
import { createRustConstructionProducer } from "./construction.js";
import { createRustClassEmissionProducer } from "./class-emission.js";
import { createRustProjectEmissionProducer } from "./project-emission.js";
import { createRustCarrierReadProducer } from "./carrier-reads.js";
import { createRustIndexedRecordProducer } from "./indexed-records.js";
import { createRustObjectProjectionProducer } from "./object-projections.js";
import { createRustStructuralEmissionProducer } from "./structural-emission.js";
import { createRustStoredFieldProducer } from "./stored-fields.js";
import { createRustProjectClassProducer } from "./project-classes.js";
import { createRustObjectLiteralEmissionProducer } from "./object-literal-emission.js";
import { createRustNativeDeclarationProducer } from "./native-declarations.js";
import { createRustNativeLivenessProducer } from "./native-liveness.js";
import { createRustNativeGenericProducer } from "./native-generics.js";

export function createRustProgramRecordBuilder(
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  parent?: RustAnalysisRecords,
): RustProgramRecordBuilder {
  let sealed = false;
  let minimumFoundation: RustFoundation = "core";
  const assertOpen = (): void => {
    if (sealed) throw new Error("Rust semantic plans cannot be written after analysis is sealed.");
  };
  const requireFoundation = (foundation: RustFoundation): void => {
    minimumFoundation = maximumRustFoundation(minimumFoundation, foundation);
  };
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
  const statementExits = createRustStatementExitProducer(assertOpen);
  const statementCompletions = createRustStatementCompletionProducer(assertOpen);
  const resourceScopes = createRustResourceScopeProducer(assertOpen);
  const localBindings = createRustLocalBindingProducer(assertOpen);
  const fieldProjectionAssignments = createRustFieldProjectionAssignmentProducer(assertOpen);
  const assignmentWrites = createRustAssignmentWriteProducer(assertOpen);
  const borrowedElements = createRustBorrowedElementProducer(assertOpen);
  const fieldWrites = createRustFieldWriteProducer(assertOpen);
  const borrowedInitializers = createRustBorrowedInitializerProducer(assertOpen);
  const captureStorage = createRustCaptureStorageProducer(assertOpen);
  const bindingEmission = createRustBindingEmissionProducer(assertOpen);
  const declarationEmission = createRustDeclarationEmissionProducer(assertOpen);
  const lexicalValuePlans = createRustLexicalValueProducer(assertOpen);
  const nativeProtocolPlans = createRustNativeProtocolProducer(assertOpen);
  const errorEmissionPlans = createRustErrorEmissionProducer(assertOpen);
  const classInitializationPlans = createRustClassInitializationProducer(assertOpen);
  const callableParameterPlans = createRustCallableParameterProducer(assertOpen);
  const genericEmissionPlans = createRustGenericEmissionProducer(assertOpen);
  const lexicalFunctionPlans = createRustLexicalFunctionProducer(assertOpen);
  const callableDeclarationPlans = createRustCallableDeclarationProducer(assertOpen);
  const methodEmissionPlans = createRustMethodEmissionProducer(assertOpen);
  const frameEmissionPlans = createRustFrameEmissionProducer(assertOpen);
  const suspendedCallablePlans = createRustSuspendedCallableProducer(assertOpen);
  const constructionPlans = createRustConstructionProducer(assertOpen);
  const classEmissionPlans = createRustClassEmissionProducer(assertOpen);
  const projectEmissionPlans = createRustProjectEmissionProducer(assertOpen);
  const sourcePackageEmission = createRustSourcePackageEmissionProducer(assertOpen);
  const sourceArtifactPlans = createRustSourceArtifactProducer(assertOpen);
  const safetyEmissionPlans = createRustSafetyEmissionProducer(assertOpen);
  const arrayLiteralPlans = createRustArrayLiteralProducer(assertOpen);
  const sourceBindingEmissionPlans = createRustSourceBindingEmissionProducer(assertOpen);
  const sourceFileEmissionPlans = createRustSourceFileEmissionProducer(assertOpen);
  const providerEvaluationPlans = createRustProviderEvaluationProducer(assertOpen);
  const errorTransportEmissionPlans = createRustErrorTransportEmissionProducer(assertOpen);
  const dispatchContextEmissionPlans = createRustDispatchContextEmissionProducer(assertOpen);
  const carrierReadPlans = createRustCarrierReadProducer(assertOpen);
  const typeEmissionPlans = createRustTypeEmissionProducer(assertOpen);
  const indexedRecordPlans = createRustIndexedRecordProducer(assertOpen);
  const objectProjectionPlans = createRustObjectProjectionProducer(assertOpen);
  const structuralEmissionPlans = createRustStructuralEmissionProducer(assertOpen);
  const storedFieldPlans = createRustStoredFieldProducer(assertOpen);
  const projectClassPlans = createRustProjectClassProducer(assertOpen);
  const objectLiteralEmissionPlans = createRustObjectLiteralEmissionProducer(assertOpen);
  const nativeDeclarations = createRustNativeDeclarationProducer(assertOpen);
  const nativeLiveness = createRustNativeLivenessProducer(assertOpen);
  const nativeGenericPlans = createRustNativeGenericProducer(assertOpen);

  const records: RustAnalysisRecords = Object.freeze({
    ...borrowedElements.records,
    ...fieldWrites.records,
    borrowedInitializer: borrowedInitializers.records,
    captureStorageScope: captureStorage.records,
    bindingProjectionEmission: bindingEmission.records,
    ...declarationEmission.records,
    nativeDeclaration: nativeDeclarations.declarations,
    nativeTypeFamilyImplementations: nativeDeclarations.implementations,
    declarationLiveness: nativeLiveness.declarations,
    ...nativeLiveness.emission,
    nativeGenerics: nativeGenericPlans.records,
    ...typeEmissionPlans.records,
    ...nativeGenericPlans.emission,
    lexicalValues: lexicalValuePlans.records,
    nativeProtocols: nativeProtocolPlans.inventories,
    nativeProtocol: nativeProtocolPlans.protocol,
    ...errorEmissionPlans.records,
    nativeErrorRegion: errorEmissionPlans.regions,
    classInitialization: classInitializationPlans.classes,
    staticFieldStorage: classInitializationPlans.fields,
    callableParameter: callableParameterPlans.records,
    ...genericEmissionPlans.records,
    lexicalFunction: lexicalFunctionPlans.records,
    callableDeclaration: callableDeclarationPlans.records,
    ...methodEmissionPlans.records,
    ...frameEmissionPlans.records,
    suspendedDeclaration: suspendedCallablePlans.implementations,
    suspendedDeclarations: suspendedCallablePlans.declarations,
    classConstruction: constructionPlans.records,
    ...constructionPlans.emissionRecords,
    nativeClass: classEmissionPlans.records,
    ...classEmissionPlans.visibilityRecords,
    ...classEmissionPlans.environmentRecords,
    ...classEmissionPlans.forwarderRecords,
    ...classEmissionPlans.implementationRecords,
    ...projectEmissionPlans.records,
    ...sourcePackageEmission.records,
    ...sourceArtifactPlans.records,
    ...safetyEmissionPlans.records,
    ...arrayLiteralPlans.records,
    ...sourceBindingEmissionPlans.records,
    ...sourceFileEmissionPlans.records,
    ...providerEvaluationPlans.records,
    ...errorTransportEmissionPlans.records,
    ...dispatchContextEmissionPlans.records,
    ...carrierReadPlans.records,
    ...indexedRecordPlans.records,
    ...objectProjectionPlans.records,
    ...structuralEmissionPlans.records,
    ...storedFieldPlans.records,
    ...projectClassPlans.records,
    ...objectLiteralEmissionPlans.records,
    ...statementCompletions.records,
    ...resourceScopes.records,
    localBinding: localBindings.records,
    fieldProjectionAssignment: fieldProjectionAssignments.records,
    assignmentWrite: assignmentWrites.records,
    statementExit: statementExits.records,
    moduleFallthrough: statementExits.modules,
    loopForm: statementExits.forms,
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
  });
  return Object.freeze({
    ...records,
    readers: records,
    statementExits,
    statementCompletions,
    resourceScopes,
    localBindings,
    fieldProjectionAssignments,
    assignmentWrites,
    borrowedElements,
    fieldWrites,
    borrowedInitializers,
    captureStorage,
    bindingEmission,
    declarationEmission,
    lexicalValuePlans,
    nativeProtocolPlans,
    errorEmissionPlans,
    classInitializationPlans,
    callableParameterPlans,
    genericEmissionPlans,
    lexicalFunctionPlans,
    callableDeclarationPlans,
    methodEmissionPlans,
    frameEmissionPlans,
    suspendedCallablePlans,
    constructionPlans,
    classEmissionPlans,
    projectEmissionPlans,
    sourcePackageEmission,
    sourceArtifactPlans,
    safetyEmissionPlans,
    arrayLiteralPlans,
    sourceBindingEmissionPlans,
    sourceFileEmissionPlans,
    providerEvaluationPlans,
    errorTransportEmissionPlans,
    dispatchContextEmissionPlans,
    carrierReadPlans,
    typeEmissionPlans,
    indexedRecordPlans,
    objectProjectionPlans,
    structuralEmissionPlans,
    storedFieldPlans,
    projectClassPlans,
    objectLiteralEmissionPlans,
    nativeDeclarations,
    nativeLiveness,
    nativeGenericPlans,
    assertOpen,
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
    minimumFoundation(): RustFoundation {
      return maximumRustFoundation(minimumFoundation, selectedOperations.minimumFoundation());
    },
    seal(required: readonly RustRequiredRecord[]): RustAnalysisRecords {
      if (sealed) throw new Error("Rust semantic plans can be sealed only once.");
      assertRustRequiredRecords(records, required);
      selectedOperations.seal();
      sealed = true;
      return records;
    },
  });
}

export function createRustProgramRecords(records: RustAnalysisRecords): RustProgramRecords {
  const { memoryBindingPlan, rawLocationPlan, rawAddressPlan, memoryLayoutObservation, typedLocationPlan, ...published } = records;
  return Object.freeze(published);
}
