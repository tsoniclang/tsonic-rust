import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustValueReadOwnership =
  | { readonly kind: "copy" | "move" | "clone" }
  | { readonly kind: "borrow"; readonly mutable: boolean };

export interface RustBorrowedFieldWrite {
  readonly target: Node;
  readonly value: Node;
  readonly receiver: Node;
  readonly owner: Node;
  readonly field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>;
  readonly fallible: boolean;
  readonly location: "captured-field" | "stored-field";
}

export interface RustReadUse {
  readonly mode: "value" | "shared" | "mutable" | "move";
  readonly later: readonly Node[];
  readonly laterStart: number;
  readonly stableAcrossEffects: boolean;
}

export interface RustReadOwnershipFact {
  readonly carrier: TargetTypeRef;
  readonly source: RustValueReadOwnership;
  readonly value: RustValueReadOwnership;
  readonly snapshot: RustValueReadOwnership | undefined;
  readonly stablePlace: boolean;
  readonly readsStorage: boolean;
  readonly pure: boolean;
  readonly sharedReference: boolean;
  readonly borrowedAcross: ReadonlySet<Node>;
}

export interface RustCaptureReadOwnership {
  readonly declaration: Node;
  readonly reference: Node;
  readonly carrier: TargetTypeRef;
  readonly read: RustValueReadOwnership;
  readonly invocation: RustValueReadOwnership;
  readonly borrowed: RustValueReadOwnership | undefined;
}

export interface RustOwnershipRecords {
  readonly uses: ReadonlyMap<Node, RustReadUse>;
  readonly reads: ReadonlyMap<Node, RustReadOwnershipFact>;
  readonly captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]>;
  readonly writes: ReadonlyMap<Node, RustBorrowedFieldWrite>;
}
