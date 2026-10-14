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
import type { RustAsyncFunctionProducer } from "./async-function.js";
import type { RustYieldProducer } from "./yield.js";
import type { RustComputedMemberProducer } from "./computed-member.js";
import type { RustCompoundWriteProducer } from "./compound-write.js";

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
  "asyncFunction" | "yield" | "computedMember" | "compoundWrite";

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
  readonly asyncFunctions: RustAsyncFunctionProducer;
  readonly yields: RustYieldProducer;
  readonly computedMembers: RustComputedMemberProducer;
  readonly compoundWrites: RustCompoundWriteProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
