import { defineRustPlanKey } from "../key.js";
import type { RustPropertyProjectionFact } from "../../../../target-model/records/property-projections.js";

export const rustPropertyProjectionFactKey = defineRustPlanKey<RustPropertyProjectionFact>(
  "propertyProjection", (left, right) => left === right,
);
