import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustConversionSelection } from "../../../../target-model/records/selections.js";

export const rustConversionKey = defineRustPlanKey<RustConversionSelection>(
  "conversion",
  (left, right) => rustTargetTypeRefEquals(left.convertedType, right.convertedType),
);
