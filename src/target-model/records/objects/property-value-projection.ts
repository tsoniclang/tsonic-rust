import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustPropertyProjectionCase } from "./property-projections.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";

export interface RustPropertyValueProjectionEmission {
  readonly projection: RustPropertyProjectionCase;
  readonly contract: Extract<RustValueConversionContract, { readonly lowering: "js-value-from-properties" }>;
}

export interface RustPropertyValueProjectionRecords {
  readonly propertyValueProjection: { readonly get: (node: Node, source: TargetTypeRef) => RustPropertyValueProjectionEmission | undefined };
}
