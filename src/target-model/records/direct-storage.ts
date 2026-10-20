import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "./finalized-operation.js";
import type { RustTargetOperationFact } from "./operations.js";

export type RustDirectStorageEmission =
  | { readonly kind: "unavailable" }
  | { readonly kind: "identifier" }
  | { readonly kind: "this" }
  | { readonly kind: "parenthesized"; readonly inner: Node }
  | { readonly kind: "field"; readonly receiver: Node; readonly path: readonly string[] }
  | { readonly kind: "provider"; readonly operation: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;
      readonly receiver: Node | undefined; readonly index: Node | undefined; readonly receiverInput: RustFinalizedSourceInput | undefined }
  | { readonly kind: "tuple" | "fixed"; readonly receiver: Node; readonly index: Node; readonly position: number; readonly evaluateIndex: boolean };

export interface RustDirectStorageIdentity {
  readonly resolved: boolean;
  readonly invalidatedRoots: ReadonlySet<Node>;
}
