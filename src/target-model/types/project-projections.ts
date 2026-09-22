import type { TargetTypeRef } from "./model.js";

export type RustProjectProjectionSelection =
  | { readonly kind: "closed" | "checked"; readonly slot: string }
  | { readonly kind: "generic" };

export interface RustProjectProjectionRequirement {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly requiresBound: boolean;
}
