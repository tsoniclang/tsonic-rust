import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedOperationProducer } from "./selected-operation.js";
import type { RustRuntimeCarrierProducer } from "./runtime-carrier.js";
import type { RustSelectedCallProducer } from "./selected-call.js";
import type { RustTargetOperationProducer } from "./target-operation.js";
import type { RustNativeArrayStorageProducer } from "./native-array-storage.js";
import type { RustNativeBackingProducer } from "./native-backing.js";
import type { RustRawLocationProducer } from "./raw-locations.js";
import type { RustMemoryBindingProducer } from "./memory-bindings.js";
import type { RustRawAddressProducer } from "./raw-addresses.js";
import type { RustReceiverIndependentMethodProducer } from "./receiver-independent-method.js";
import type { RustClassValueProducer } from "./class-value.js";
import type { RustObjectLiteralMethodAdapterProducer } from "./object-literal-method-adapter.js";
import type { RustProjectCallableAdapterProducer } from "./project-callable-adapters.js";
import type { RustObjectReferenceViewProducer } from "./object-reference-view.js";
import type { RustAwaitSourceErrorEffectsProducer } from "./await-source-error-effects.js";
import type { RustErrorEffectsProducer } from "./error-effects.js";
import type { RustFallibleProducer } from "./fallible.js";
import type { RustGenericCallableInvocationProducer } from "./generic-callable-invocation.js";
import type { RustSourceAccessorEffectsProducer } from "./source-accessor-effects.js";
import type { RustSourceCallEffectsProducer } from "./source-call-effects.js";
import type { RustSourceErrorEffectsProducer } from "./source-error-effects.js";
import type { RustAwaitValueProducer } from "./await-value.js";
import type { RustFutureValueProducer } from "./future-value.js";
import type { RustResourceManagementProducer } from "./resource-management.js";
import type { RustDeferredProducerEffectsProducer } from "./deferred-producer-effects.js";
import type { RustNativeGuardResultProducer } from "./native-guard-result.js";
import type { RustNativeUnreachableProducer } from "./native-unreachable.js";
import type { RustGenericNumericOperandsProducer } from "./generic-numeric-operands.js";
import type { RustIndexedFieldKeyArgumentProducer } from "./indexed-field-key-argument.js";
import type { RustPropertyProjectionProducer } from "./property-projection.js";
import type { RustTypeOnlyDeclarationProducer } from "./type-only-declaration.js";
import type { RustModuleBindingProducer } from "./module-binding.js";
import type { RustModuleCallableStorageProducer } from "./module-callable-storage.js";
import type { RustSourceCallableReturnProducer } from "./source-callable-return.js";
import type { RustCapturedFieldStorageProducer } from "./captured-field-storage.js";
import type { RustCallScopedLifetimeReconciliationProducer } from "./call-scoped-lifetime-reconciliation.js";
import type { RustProjectUpcastProducer } from "./project-upcast.js";
import type { RustProjectDowncastProducer } from "./project-downcast.js";
import type { RustAsyncFunctionProducer } from "./async-function.js";
import type { RustYieldProducer } from "./yield.js";
import type { RustComputedMemberProducer } from "./computed-member.js";
import type { RustCompoundWriteProducer } from "./compound-write.js";
import type { RustTypeAliasDeclarationProducer } from "./type-alias-declaration.js";
import type { RustMutatedBindingProducer } from "./mutated-binding.js";
import type { RustMutatedReferentProducer } from "./mutated-referent.js";
import type { RustArgumentPassingProducer } from "./argument-passing.js";
import type { RustBindingStorageProducer } from "./binding-storage.js";
import type { RustRetainedCallLifetimesProducer } from "./retained-call-lifetimes.js";
import type { RustBindingProjectionProducer } from "./binding-projection.js";
import type { RustTypedLocationProducer } from "./typed-location-plan.js";
import type { RustCompileTimeSourceProducer } from "./compile-time-source.js";
import type { RustSelfModeProducer } from "./self-mode.js";
import type { RustMemoryLayoutObservationProducer } from "./memory-layout-observation.js";
import type { RustGeneratorProducer } from "./generator.js";
import type { RustSourceParameterAbiProducer } from "./source-parameter-abi.js";
import type { RustSourceBindingProducer } from "./source-binding.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "nativeArrayStorage" | "nativeBacking" | "rawLocationPlan" | "memoryBindingPlan" | "rawAddressPlan" |
  "receiverIndependentMethod" | "classValue" | "objectLiteralMethodAdapter" | "projectCallableAdapters" | "objectReferenceView" |
  "awaitSourceErrorEffects" | "errorEffects" | "fallible" | "genericCallableInvocation" |
  "sourceAccessorEffects" | "sourceCallEffects" | "sourceErrorEffects" | "awaitValue" |
  "futureValue" | "resourceManagement" | "deferredProducerEffects" |
  "nativeGuardResult" | "nativeUnreachable" | "genericNumericOperands" | "indexedFieldKeyArgument" | "propertyProjection" |
  "typeOnlyDeclaration" | "moduleBinding" | "moduleCallableStorage" | "sourceCallableReturn" | "capturedFieldStorage" |
  "callScopedLifetimeReconciliation" | "projectUpcast" | "projectDowncast" |
  "asyncFunction" | "yield" | "computedMember" | "compoundWrite" |
  "typeAliasDeclaration" | "mutatedBinding" | "mutatedReferent" |
  "argumentPassing" | "bindingStorage" | "retainedCallLifetimes" | "bindingProjection" | "typedLocationPlan" |
  "compileTimeSource" | "selfMode" | "memoryLayoutObservation" |
  "generator" | "sourceParameterAbi" | "sourceBinding";

export type RustProgramRecordWriter = {
  readonly [Family in Exclude<keyof RustProgramRecords, RustProducedRecordFamily>]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
} & Pick<RustProgramRecords, RustProducedRecordFamily> & {
  readonly selectedOperations: RustSelectedOperationProducer;
  readonly runtimeCarriers: RustRuntimeCarrierProducer;
  readonly selectedCalls: RustSelectedCallProducer;
  readonly targetOperations: RustTargetOperationProducer;
  readonly nativeArrays: RustNativeArrayStorageProducer;
  readonly nativeBackings: RustNativeBackingProducer;
  readonly rawLocations: RustRawLocationProducer;
  readonly memoryBindings: RustMemoryBindingProducer;
  readonly rawAddresses: RustRawAddressProducer;
  readonly receiverIndependentMethods: RustReceiverIndependentMethodProducer;
  readonly classValues: RustClassValueProducer;
  readonly objectLiteralMethodAdapters: RustObjectLiteralMethodAdapterProducer;
  readonly projectCallableAdapterPlans: RustProjectCallableAdapterProducer;
  readonly objectReferenceViews: RustObjectReferenceViewProducer;
  readonly awaitSourceErrors: RustAwaitSourceErrorEffectsProducer;
  readonly errorEffectPlans: RustErrorEffectsProducer;
  readonly fallibleSubjects: RustFallibleProducer;
  readonly genericCallableInvocations: RustGenericCallableInvocationProducer;
  readonly sourceAccessorEffectPlans: RustSourceAccessorEffectsProducer;
  readonly sourceCallEffectPlans: RustSourceCallEffectsProducer;
  readonly sourceErrorEdges: RustSourceErrorEffectsProducer;
  readonly awaitValues: RustAwaitValueProducer;
  readonly futureValues: RustFutureValueProducer;
  readonly resourceManagementPlans: RustResourceManagementProducer;
  readonly deferredProducerChannels: RustDeferredProducerEffectsProducer;
  readonly nativeGuardResults: RustNativeGuardResultProducer;
  readonly nativeUnreachableNodes: RustNativeUnreachableProducer;
  readonly genericNumerics: RustGenericNumericOperandsProducer;
  readonly indexedFieldKeys: RustIndexedFieldKeyArgumentProducer;
  readonly propertyProjections: RustPropertyProjectionProducer;
  readonly typeOnlyDeclarations: RustTypeOnlyDeclarationProducer;
  readonly moduleBindings: RustModuleBindingProducer;
  readonly moduleCallableStoragePlans: RustModuleCallableStorageProducer;
  readonly sourceCallableReturns: RustSourceCallableReturnProducer;
  readonly capturedFieldStoragePlans: RustCapturedFieldStorageProducer;
  readonly callScopedLifetimes: RustCallScopedLifetimeReconciliationProducer;
  readonly projectUpcasts: RustProjectUpcastProducer;
  readonly projectDowncasts: RustProjectDowncastProducer;
  readonly asyncFunctions: RustAsyncFunctionProducer;
  readonly yields: RustYieldProducer;
  readonly computedMembers: RustComputedMemberProducer;
  readonly compoundWrites: RustCompoundWriteProducer;
  readonly typeAliasDeclarations: RustTypeAliasDeclarationProducer;
  readonly mutatedBindings: RustMutatedBindingProducer;
  readonly mutatedReferents: RustMutatedReferentProducer;
  readonly argumentPassingPlans: RustArgumentPassingProducer;
  readonly bindingStoragePlans: RustBindingStorageProducer;
  readonly retainedCalls: RustRetainedCallLifetimesProducer;
  readonly bindingProjections: RustBindingProjectionProducer;
  readonly typedLocations: RustTypedLocationProducer;
  readonly compileTimeSources: RustCompileTimeSourceProducer;
  readonly selfModes: RustSelfModeProducer;
  readonly memoryLayoutObservations: RustMemoryLayoutObservationProducer;
  readonly generators: RustGeneratorProducer;
  readonly sourceParameterAbis: RustSourceParameterAbiProducer;
  readonly sourceBindings: RustSourceBindingProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
