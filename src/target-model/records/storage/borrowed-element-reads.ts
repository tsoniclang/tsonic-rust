import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../program.js";

export interface RustBorrowedElementRead {
  readonly receiver: Node;
  readonly element: Node;
  readonly array: Node;
  readonly index: Node;
  readonly method: string;
}

export interface RustBorrowedElementLocal extends RustBorrowedElementRead {
  readonly declaration: Node;
  readonly references: readonly Node[];
  readonly lastStatement: Node;
}

export interface RustBorrowedIterationBinding {
  readonly declaration: Node;
  readonly references: readonly Node[];
}

export interface RustBorrowedElementRecords {
  readonly borrowedElementAppend: RustRecordFamily<boolean>;
  readonly borrowedElementRead: RustRecordFamily<RustBorrowedElementRead>;
  readonly borrowedElement: RustRecordFamily<RustBorrowedElementRead>;
  readonly borrowedElementLocal: RustRecordFamily<RustBorrowedElementLocal>;
  readonly borrowedElementEnds: RustRecordFamily<readonly RustBorrowedElementLocal[]>;
  readonly borrowedIterationBinding: RustRecordFamily<RustBorrowedIterationBinding>;
}
