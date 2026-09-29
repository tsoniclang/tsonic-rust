import type { TargetTypeRef } from "./model.js";

export type RustProjectProjectionSelection =
  | { readonly kind: "closed" | "checked" | "structural"; readonly slot: string }
  | { readonly kind: "generic" };

export interface RustProjectDowncastFact {
  readonly projection: RustProjectProjectionSelection;
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export interface RustProjectProjectionRequirement {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly requiresBound: boolean;
}
