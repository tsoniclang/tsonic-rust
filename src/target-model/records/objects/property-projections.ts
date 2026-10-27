import type { RustValueConversion } from "../../operations/model.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectFieldSelection } from "./project-fields.js";
import type { RustProjectAccessorSelection } from "./project-accessors.js";

export interface RustPropertyProjectionCase {
  readonly source: TargetTypeRef;
  readonly conversion: Extract<RustValueConversion, { readonly kind: "js-value-from-properties" }>;
  readonly reads: readonly (RustProjectFieldSelection | RustProjectAccessorSelection)[];
}

export interface RustPropertyProjectionFact {
  readonly conversion: RustValueConversion;
  readonly cases: readonly RustPropertyProjectionCase[];
}
