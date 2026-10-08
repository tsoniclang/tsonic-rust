import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectFieldSelection } from "../operations/provider/project-fields.js";
import type { RustProjectAccessorSelection } from "../operations/provider/project-accessors.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";

export interface RustPropertyProjectionCase {
  readonly source: TargetTypeRef;
  readonly conversion: Extract<RustValueConversion, { readonly kind: "js-value-from-properties" }>;
  readonly reads: readonly (RustProjectFieldSelection | RustProjectAccessorSelection)[];
}

export interface RustPropertyProjectionFact {
  readonly conversion: RustValueConversion;
  readonly cases: readonly RustPropertyProjectionCase[];
}

export const rustPropertyProjectionFactKey = defineRustPlanKey<RustPropertyProjectionFact>(
  "propertyProjection", (left, right) => left === right,
);
