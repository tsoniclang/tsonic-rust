import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject, TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustEmissionProviderOperation, RustPhysicalEmissionContext, RustPhysicalEmissionOperand,
  RustPhysicalEmissionSourceOrigin, RustPhysicalEmissionSourceOrigins,
  RustPhysicalEmissionSourceSlot } from "./physical-emission-contexts.js";
import type { RustFinalizedNativeResultLoans, RustFinalizedSourceInput } from "./finalized-operation.js";
import type { RustNativeResultLoan, RustNativeResultLoanOrigin } from "../operations/result-loans.js";

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
  readonly reads: ReadonlyMap<Node, RustReadOwnershipFact>;
  readonly captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]>;
  readonly writes: ReadonlyMap<Node, RustBorrowedFieldWrite>;
  readonly nativePlaces: ReadonlyMap<TargetUseSiteRef, RustNativeInputPlace>;
  readonly nativeResultLoans: RustNativeResultLoanIndex;
}

export interface RustNativePlace {
  readonly node: Node;
  readonly operand: RustPhysicalEmissionOperand;
  readonly carrier: TargetTypeRef;
  readonly sourcePath: { readonly declaration: Node; readonly projections: readonly (Node | string)[] } | undefined;
  readonly storage:
    | { readonly kind: "promoted"; readonly expression: Node; readonly declaration: Node;
        readonly storage: "location" | "module-cell" | "cell" | "borrow-cell" | "native-array" }
    | { readonly kind: "direct" }
    | { readonly kind: "project-field"; readonly receiverNode: Node;
        readonly rootDeclaration: Node | undefined; readonly storagePath: readonly string[] }
    | { readonly kind: "owned"; readonly read: Exclude<RustValueReadOwnership, { readonly kind: "borrow" }> };
}

export interface RustNativeInputPlace {
  readonly input: RustFinalizedSourceInput;
  readonly key: string;
  readonly node: Node;
  readonly slot: RustPhysicalEmissionSourceSlot;
  readonly operand: RustPhysicalEmissionOperand;
  readonly place: RustNativePlace;
}

export interface RustNativeResultPlaceLoan {
  readonly declaration: RustNativeResultLoan;
  readonly resultPath: readonly string[];
  readonly origins: readonly { readonly declaration: RustNativeResultLoanOrigin; readonly input: RustNativeInputPlace;
    readonly kind: "borrow" | "carried" }[];
}

export type RustNativeResultPlaceSelection =
  | { readonly kind: "resolved"; readonly node: Node; readonly operation: RustEmissionProviderOperation;
      readonly context: RustPhysicalEmissionContext; readonly carrier: TargetTypeRef;
      readonly native: RustFinalizedNativeResultLoans; readonly loans: readonly RustNativeResultPlaceLoan[] }
  | { readonly kind: "unavailable"; readonly node: Node; readonly reasons: readonly string[] };

export type RustResultLoanSourceSelection =
  | { readonly kind: "resolved"; readonly context: RustPhysicalEmissionContext;
      readonly sourceOrigins: Extract<RustPhysicalEmissionSourceOrigins, { readonly kind: "resolved" }> | undefined;
      readonly alternatives: readonly { readonly origin: RustPhysicalEmissionSourceOrigin;
        readonly bindings: SourceStorageBindings;
        readonly loans: readonly { readonly native: RustNativeResultPlaceLoan;
          readonly origins: readonly { readonly native: RustNativeResultPlaceLoan["origins"][number];
            readonly subject: SourceStorageSubject; readonly sources: readonly SourceStorageSubject[] }[] }[] }[] }
  | { readonly kind: "unavailable"; readonly node: Node; readonly reasons: readonly string[] };

export interface RustNativeResultOwnership {
  readonly node: Node;
  readonly operation: RustEmissionProviderOperation;
  readonly context: RustPhysicalEmissionContext;
  readonly place: RustNativeResultPlaceSelection;
  readonly source: RustResultLoanSourceSelection;
}

export type RustNativeResultLoanIndex = ReadonlyMap<Node,
  ReadonlyMap<RustEmissionProviderOperation, ReadonlyMap<TargetUseSiteRef, RustNativeResultOwnership>>>;
