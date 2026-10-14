import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedOperationProducer } from "./selected-operation.js";
import type { RustRuntimeCarrierProducer } from "./runtime-carrier.js";
import type { RustSelectedCallProducer } from "./selected-call.js";
import type { RustTargetOperationProducer } from "./target-operation.js";
import type { RustReceiverIndependentMethodProducer } from "./receiver-independent-method.js";
import type { RustClassValueProducer } from "./class-value.js";
import type { RustObjectLiteralMethodAdapterProducer } from "./object-literal-method-adapter.js";
import type { RustProjectCallableAdapterProducer } from "./project-callable-adapters.js";
import type { RustObjectReferenceViewProducer } from "./object-reference-view.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

type RustProducedRecordFamily = "selectedOperation" | "runtimeCarrier" | "selectedCall" | "targetOperation" |
  "receiverIndependentMethod" | "classValue" | "objectLiteralMethodAdapter" | "projectCallableAdapters" | "objectReferenceView";

export type RustProgramRecordWriter = {
  readonly [Family in Exclude<keyof RustProgramRecords, RustProducedRecordFamily>]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
} & Pick<RustProgramRecords, RustProducedRecordFamily> & {
  readonly selectedOperations: RustSelectedOperationProducer;
  readonly runtimeCarriers: RustRuntimeCarrierProducer;
  readonly selectedCalls: RustSelectedCallProducer;
  readonly targetOperations: RustTargetOperationProducer;
  readonly receiverIndependentMethods: RustReceiverIndependentMethodProducer;
  readonly classValues: RustClassValueProducer;
  readonly objectLiteralMethodAdapters: RustObjectLiteralMethodAdapterProducer;
  readonly projectCallableAdapterPlans: RustProjectCallableAdapterProducer;
  readonly objectReferenceViews: RustObjectReferenceViewProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
