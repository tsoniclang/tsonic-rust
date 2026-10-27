import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustBorrowedInitializer } from "../../../../target-model/records/storage/borrowed-initializers.js";
import { createRustRecordFamily } from "../family.js";

export interface RustBorrowedInitializerProducer {
  readonly records: RustRecordFamily<RustBorrowedInitializer>;
  retain(subject: Node, value: RustBorrowedInitializer): void;
}

export function createRustBorrowedInitializerProducer(assertOpen: () => void): RustBorrowedInitializerProducer {
  const values = createRustRecordFamily<RustBorrowedInitializer>({ id: "tsonic.rust.borrowedInitializer", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: values.reader,
    retain: (subject: Node, value: RustBorrowedInitializer): void => values.writer.set(subject, Object.freeze(value)) });
}
