import type { Node } from "@tsonic/tsts";
import type { RustFieldWriteRecords, RustProjectFieldDispatchPlan, RustMethodWriteReceiver, RustFrozenWriteReceiver } from "../../../../target-model/records/storage/field-writes.js";
import type { RustBorrowedFieldWrite } from "../../../../target-model/records/storage/ownership.js";
import type { RustAccessorReceiver } from "../../../../target-model/records/storage/field-writes.js";
import { createRustRecordFamily } from "../family.js";

export interface RustFieldWriteProducer {
  readonly records: RustFieldWriteRecords;
  accessor(subject: Node, value: RustAccessorReceiver): void;
  frozen(subject: Node, value: RustFrozenWriteReceiver): void;
  borrowed(subject: Node, value: RustBorrowedFieldWrite): void;
  dispatch(subject: Node, value: RustProjectFieldDispatchPlan): void;
  receiver(subject: Node, value: RustMethodWriteReceiver): void;
}

export function createRustFieldWriteProducer(assertOpen: () => void): RustFieldWriteProducer {
  const accessors = createRustRecordFamily<RustAccessorReceiver>({ id: "tsonic.rust.accessorReceiver", equals: (left, right) => left === right }, assertOpen);
  const frozen = createRustRecordFamily<RustFrozenWriteReceiver>({ id: "tsonic.rust.frozenDataReceiver", equals: (left, right) => left === right }, assertOpen);
  const borrowed = createRustRecordFamily<RustBorrowedFieldWrite>({ id: "tsonic.rust.borrowedFieldWrite", equals: (left, right) => left === right }, assertOpen);
  const dispatch = createRustRecordFamily<RustProjectFieldDispatchPlan>({ id: "tsonic.rust.projectFieldDispatch", equals: (left, right) => left === right }, assertOpen);
  const receivers = createRustRecordFamily<RustMethodWriteReceiver>({ id: "tsonic.rust.methodWriteReceiver", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ accessorReceiver: accessors.reader, frozenDataReceiver: frozen.reader, borrowedFieldWrite: borrowed.reader, projectFieldDispatch: dispatch.reader, methodWriteReceiver: receivers.reader }),
    accessor: (subject: Node, value: RustAccessorReceiver): void => accessors.writer.set(subject, Object.freeze(value)),
    frozen: (subject: Node, value: RustFrozenWriteReceiver): void => frozen.writer.set(subject, value),
    borrowed: (subject: Node, value: RustBorrowedFieldWrite): void => borrowed.writer.set(subject, value),
    dispatch: (subject: Node, value: RustProjectFieldDispatchPlan): void => dispatch.writer.set(subject, value),
    receiver: (subject: Node, value: RustMethodWriteReceiver): void => receivers.writer.set(subject, Object.freeze(value)),
  });
}
