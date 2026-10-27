import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
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

export type RustObjectReferenceEmission =
  | { readonly kind: "identity"; readonly view: Extract<RustObjectReferenceView, { readonly kind: "structural" }> }
  | { readonly kind: "project"; readonly view: Extract<RustObjectReferenceView, { readonly kind: "project" }> }
  | { readonly kind: "constructor"; readonly view: Extract<RustObjectReferenceView, { readonly kind: "constructor" }> }
  | { readonly kind: "structural"; readonly view: Extract<RustObjectReferenceView, { readonly kind: "structural" }>;
    readonly dispatch: boolean; readonly fields: readonly {
      readonly source: Extract<RustObjectReferenceView, { readonly kind: "structural" }>["fields"][number]["source"];
      readonly getter: TargetTypeRef;
      readonly setter: TargetTypeRef | undefined;
    }[] };
