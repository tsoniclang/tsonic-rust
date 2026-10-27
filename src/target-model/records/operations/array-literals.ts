import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustBorrowedSequenceInput } from "../storage/borrowed-sequences.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";

export interface RustBorrowedSequenceEmission {
  readonly inputs: readonly ({ readonly kind: "empty" } | { readonly kind: "sequence";
    readonly expression: Node; readonly optional: boolean; readonly mode: "shared-receiver" | "shared-reference";
    readonly contract: Extract<RustValueConversionContract, { readonly lowering: "rest-sequence" }> })[];
}

export interface RustArrayLiteralRecords {
  readonly borrowedSequenceEmission: { readonly get: (input: RustBorrowedSequenceInput, target: TargetTypeRef) => RustBorrowedSequenceEmission | undefined };
}
