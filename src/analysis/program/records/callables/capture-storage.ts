import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustCaptureStorageScope } from "../../../../target-model/records/callables/capture-storage.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCaptureStorageProducer {
  readonly records: RustRecordFamily<RustCaptureStorageScope>;
  scope(subject: Node, value: RustCaptureStorageScope): void;
}

export function createRustCaptureStorageProducer(assertOpen: () => void): RustCaptureStorageProducer {
  const values = createRustRecordFamily<RustCaptureStorageScope>({ id: "tsonic.rust.captureStorageScope", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: values.reader,
    scope: (subject: Node, value: RustCaptureStorageScope): void => values.writer.set(subject, Object.freeze(value)) });
}
