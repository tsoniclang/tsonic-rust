import type { TargetTypeRef } from "../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { Node } from "@tsonic/tsts";

interface RustObjectReferenceViewCarriers {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export type RustObjectReferenceView = RustObjectReferenceViewCarriers & (
  | { readonly kind: "project"; readonly declaration: Node }
  | { readonly kind: "constructor"; readonly declaration: Node }
  | {
  readonly kind: "structural";
  readonly fields: readonly {
    readonly destinationIndex: number;
    readonly source: Omit<Extract<RustTargetOperationFact, {kind: "source-field"}>, "operationId" | "accessMode">;
    readonly writable: boolean;
  }[];
});
