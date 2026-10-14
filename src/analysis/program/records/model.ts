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
import type { RustTypeOnlyDeclarationProducer } from "./type-only-declaration.js";
import type { RustModuleBindingProducer } from "./module-binding.js";
import type { RustModuleCallableStorageProducer } from "./module-callable-storage.js";
import type { RustSourceCallableReturnProducer } from "./source-callable-return.js";
import type { RustCapturedFieldStorageProducer } from "./captured-field-storage.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "nativeArrayStorage" | "nativeBacking" | "rawLocationPlan" | "memoryBindingPlan" | "rawAddressPlan" |
  "receiverIndependentMethod" | "classValue" | "objectLiteralMethodAdapter" | "projectCallableAdapters" | "objectReferenceView" |
  "typeOnlyDeclaration" | "moduleBinding" | "moduleCallableStorage" | "sourceCallableReturn" | "capturedFieldStorage";

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
  readonly typeOnlyDeclarations: RustTypeOnlyDeclarationProducer;
  readonly moduleBindings: RustModuleBindingProducer;
  readonly moduleCallableStoragePlans: RustModuleCallableStorageProducer;
  readonly sourceCallableReturns: RustSourceCallableReturnProducer;
  readonly capturedFieldStoragePlans: RustCapturedFieldStorageProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
