import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export const rustGenericNumericOperandsKey = defineRustPlanKey<readonly TargetTypeRef[]>(
  "genericNumericOperands",
  (left, right) => left.length === right.length && left.every((carrier, index) =>
    rustTargetTypeRefEquals(carrier, right[index])),
);
