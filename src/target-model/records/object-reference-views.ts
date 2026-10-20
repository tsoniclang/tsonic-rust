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

export type RustObjectReferenceEmission = {
  readonly view: RustObjectReferenceView;
} & (
  | { readonly kind: "project" | "constructor" }
  | { readonly kind: "structural"; readonly dispatch: boolean; readonly fields: readonly {
      readonly source: Extract<RustObjectReferenceView, { readonly kind: "structural" }>["fields"][number]["source"];
      readonly getter: TargetTypeRef;
      readonly setter: TargetTypeRef | undefined;
    }[] }
);
