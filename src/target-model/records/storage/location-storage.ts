import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { TargetTypeRef } from "../../types/model.js";

export type RustLocationProjection =
  | { readonly kind: "root" }
  | { readonly kind: "native-array" }
  | { readonly kind: "parenthesized"; readonly inner: Node }
  | { readonly kind: "structural-field"; readonly receiver: Node; readonly name: string; readonly carrier: TargetTypeRef }
  | { readonly kind: "indexed-method"; readonly receiver: Node; readonly index: Node; readonly input: RustFinalizedSourceInput; readonly method: string }
  | { readonly kind: "member"; readonly receiver: Node; readonly operation: Extract<RustTargetOperationFact, { readonly kind: "source-field" }> }
  | { readonly kind: "index"; readonly receiver: Node; readonly index: Node; readonly input: RustFinalizedSourceInput };

export interface RustLocationStorageRecords {
  readonly locationAllocation: { readonly get: (node: Node) => RustLocationAllocation | undefined };
  readonly locationProjection: { readonly get: (node: Node) => RustLocationProjection | undefined };
  readonly sourceReferenceDeclaration: { readonly get: (node: Node) => Node | undefined };
}

export interface RustLocationAllocation {
  readonly carrier: TargetTypeRef;
  readonly pointeeCarrier: TargetTypeRef;
}
