import type { Node } from "@tsonic/tsts";
import type { RustObjectRepresentation } from "../objects/object-representation.js";
import type { RustBorrowedFieldWrite } from "./ownership.js";
import type { RustRecordFamily } from "../program.js";

export type RustFrozenWriteReceiver = "receiver" | "state" | "identity";

export interface RustProjectFieldDispatchRole {
  readonly selfMode: "ref" | "rc";
  readonly fallible: boolean;
}

export interface RustProjectFieldDispatchPlan {
  readonly declaration: Node;
  readonly readonly: boolean;
  readonly stored: boolean;
  readonly mutableContent: boolean;
  readonly read: RustProjectFieldDispatchRole;
  readonly write?: RustProjectFieldDispatchRole;
}

export type RustProjectFieldImplementation =
  | { readonly kind: "receiver-alias" | "stored"; readonly declaration: Node }
  | { readonly kind: "accessor"; readonly getter: Node; readonly setter?: Node };

export interface RustMethodWriteReceiver {
  readonly representation: RustObjectRepresentation;
  readonly check: RustFrozenWriteReceiver | undefined;
}

export interface RustFieldWriteRecords {
  readonly accessorReceiver: RustRecordFamily<RustAccessorReceiver>;
  readonly frozenDataReceiver: RustRecordFamily<RustFrozenWriteReceiver>;
  readonly borrowedFieldWrite: RustRecordFamily<RustBorrowedFieldWrite>;
  readonly projectFieldDispatch: RustRecordFamily<RustProjectFieldDispatchPlan>;
  readonly methodWriteReceiver: RustRecordFamily<RustMethodWriteReceiver>;
}

export interface RustAccessorReceiver {
  readonly receiver: Node;
  readonly value: boolean;
}
