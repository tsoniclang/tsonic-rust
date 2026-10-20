import type { RustValueConversion } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";

export type RustCallableValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "value"; readonly conversion: RustValueConversion | RustCallableConversion }
  | { readonly kind: "borrow" }
  | { readonly kind: "absence" }
  | { readonly kind: "discard" };

export interface RustCallableConversion {
  readonly kind: "callable-adapter";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly parameters: readonly RustCallableValueConversion[];
  readonly result: RustCallableValueConversion;
}
