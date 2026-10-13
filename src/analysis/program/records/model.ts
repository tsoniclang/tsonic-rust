import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../target-model/records/program.js";

export interface RustRecordWriter<T> extends RustRecordFamily<T> {
  readonly set: (subject: ExtensionFactSubject, value: T, evidence?: readonly unknown[]) => void;
}

export type RustProgramRecordWriter = {
  readonly [Family in keyof RustProgramRecords]: RustRecordWriter<Exclude<ReturnType<RustProgramRecords[Family]["get"]>, undefined>>;
};

export interface RustProgramRecordBuilder extends RustProgramRecordWriter {
  seal(): RustProgramRecords;
  minimumFoundation(): RustFoundation;
}
