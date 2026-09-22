import type { TargetTypeRef } from "./model.js";

export interface RustProjectProjectionRequirement {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}
