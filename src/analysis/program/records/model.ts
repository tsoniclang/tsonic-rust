import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedOperationProducer } from "./selected-operation.js";
import type { RustRuntimeCarrierProducer } from "./runtime-carrier.js";
import type { RustSelectedCallProducer } from "./selected-call.js";
import type { RustTargetOperationProducer } from "./target-operation.js";
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

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "awaitSourceErrorEffects" | "errorEffects" | "fallible" | "genericCallableInvocation" |
  "sourceAccessorEffects" | "sourceCallEffects" | "sourceErrorEffects" | "awaitValue" |
  "futureValue" | "resourceManagement" | "deferredProducerEffects";

export type RustProgramRecordWriter = {
  readonly [Family in Exclude<keyof RustProgramRecords, RustProducedRecordFamily>]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
} & Pick<RustProgramRecords, RustProducedRecordFamily> & {
  readonly selectedOperations: RustSelectedOperationProducer;
  readonly runtimeCarriers: RustRuntimeCarrierProducer;
  readonly selectedCalls: RustSelectedCallProducer;
  readonly targetOperations: RustTargetOperationProducer;
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
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
