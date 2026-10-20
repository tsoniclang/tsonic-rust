import type { TargetTypeRef } from "../types/model.js";

export interface RustExactIntegerConversion {
  readonly kind: "exact-integer";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}
