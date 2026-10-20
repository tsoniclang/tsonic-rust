import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "./finalized-operation.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { TargetTypeRef } from "../types/model.js";

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

export interface RustUpdateProjectField {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-field" | "source-union-field" }>;
}

export interface RustUpdateProjectionArgument {
  readonly projection: Node;
  readonly receiver: Node | undefined;
  readonly argument: Node;
  readonly carrier: TargetTypeRef;
  readonly targetInput: RustFinalizedSourceInput | undefined;
}

export type RustUpdateMember =
  | { readonly kind: "accessor"; readonly expression: Node; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }> }
  | { readonly kind: "static"; readonly expression: Node; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }> }
  | { readonly kind: "index"; readonly expression: Node; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }> };

export interface RustLocationStorageRoot {
  readonly expression: Node;
  readonly declaration: Node;
}
