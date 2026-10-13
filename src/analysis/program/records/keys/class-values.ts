import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustClassValueFact } from "../../../../target-model/records/class-values.js";

export const rustClassValueFactKey = defineRustPlanKey<RustClassValueFact>(
  "classValue",
  (left, right) => left.declaration === right.declaration &&
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.carrier, right.carrier),
);
