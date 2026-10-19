import type { Node } from "@tsonic/tsts";
import type { RustFieldWriteRecords, RustProjectFieldDispatchPlan, RustMethodWriteReceiver } from "../../../target-model/records/field-writes.js";
import type { RustBorrowedFieldWrite } from "../../../target-model/records/ownership.js";
import { createRustRecordFamily } from "./family.js";

export interface RustFieldWriteProducer {
  readonly records: RustFieldWriteRecords;
  borrowed(subject: Node, value: RustBorrowedFieldWrite): void;
  dispatch(subject: Node, value: RustProjectFieldDispatchPlan): void;
  receiver(subject: Node, value: RustMethodWriteReceiver): void;
}

export function createRustFieldWriteProducer(assertOpen: () => void): RustFieldWriteProducer {
  const borrowed = createRustRecordFamily<RustBorrowedFieldWrite>({ id: "tsonic.rust.borrowedFieldWrite", equals: (left, right) => left === right }, assertOpen);
  const dispatch = createRustRecordFamily<RustProjectFieldDispatchPlan>({ id: "tsonic.rust.projectFieldDispatch", equals: (left, right) => left === right }, assertOpen);
  const receivers = createRustRecordFamily<RustMethodWriteReceiver>({ id: "tsonic.rust.methodWriteReceiver", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ borrowedFieldWrite: borrowed.reader, projectFieldDispatch: dispatch.reader, methodWriteReceiver: receivers.reader }),
    borrowed: (subject: Node, value: RustBorrowedFieldWrite): void => borrowed.writer.set(subject, value),
    dispatch: (subject: Node, value: RustProjectFieldDispatchPlan): void => dispatch.writer.set(subject, value),
    receiver: (subject: Node, value: RustMethodWriteReceiver): void => receivers.writer.set(subject, Object.freeze(value)),
  });
}
