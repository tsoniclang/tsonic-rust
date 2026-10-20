import type { TargetTypeRef } from "../types/model.js";

export interface RustGenericCallableConversion {
  readonly kind: "generic-callable-flow";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}
