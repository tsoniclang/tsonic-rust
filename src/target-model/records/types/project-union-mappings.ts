import type { RustUnionMappingEmission } from "./union-mappings.js";
import type { RustProjectUnionMapConversion } from "../../conversions/project-union.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact } from "../objects/value-projections.js";

export interface RustProjectUnionMappingEmission {
  readonly mapping: RustUnionMappingEmission;
  readonly upcasts: readonly (RustProjectUpcastFact | null)[];
}

export interface RustProjectUnionMappingRecords {
  readonly projectUnionMapping: { readonly get: (conversion: RustProjectUnionMapConversion,
    upstream: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined) => RustProjectUnionMappingEmission | undefined };
}
