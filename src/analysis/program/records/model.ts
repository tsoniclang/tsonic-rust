import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedOperationProducer } from "../../operations/records/selected-operation.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

export type RustProgramRecordWriter = {
  readonly [Family in Exclude<keyof RustProgramRecords, "selectedOperation">]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
} & Pick<RustProgramRecords, "selectedOperation"> & {
  readonly selectedOperations: RustSelectedOperationProducer;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
