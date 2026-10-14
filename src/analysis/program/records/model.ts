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

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "nativeArrayStorage" | "nativeBacking" | "rawLocationPlan" | "memoryBindingPlan" | "rawAddressPlan";

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
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
