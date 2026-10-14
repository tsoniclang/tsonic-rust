import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedOperationProducer } from "./selected-operation.js";
import type { RustRuntimeCarrierProducer } from "./runtime-carrier.js";
import type { RustSelectedCallProducer } from "./selected-call.js";
import type { RustTargetOperationProducer } from "./target-operation.js";
import type { RustNativeGuardResultProducer } from "./native-guard-result.js";
import type { RustNativeUnreachableProducer } from "./native-unreachable.js";
import type { RustGenericNumericOperandsProducer } from "./generic-numeric-operands.js";
import type { RustIndexedFieldKeyArgumentProducer } from "./indexed-field-key-argument.js";
import type { RustPropertyProjectionProducer } from "./property-projection.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "nativeGuardResult" | "nativeUnreachable" | "genericNumericOperands" | "indexedFieldKeyArgument" | "propertyProjection";

export type RustProgramRecordWriter = {
  readonly [Family in Exclude<keyof RustProgramRecords, RustProducedRecordFamily>]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
} & Pick<RustProgramRecords, RustProducedRecordFamily> & {
  readonly selectedOperations: RustSelectedOperationProducer;
  readonly runtimeCarriers: RustRuntimeCarrierProducer;
  readonly selectedCalls: RustSelectedCallProducer;
  readonly targetOperations: RustTargetOperationProducer;
  readonly nativeGuardResults: RustNativeGuardResultProducer;
  readonly nativeUnreachableNodes: RustNativeUnreachableProducer;
  readonly genericNumerics: RustGenericNumericOperandsProducer;
  readonly indexedFieldKeys: RustIndexedFieldKeyArgumentProducer;
  readonly propertyProjections: RustPropertyProjectionProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
