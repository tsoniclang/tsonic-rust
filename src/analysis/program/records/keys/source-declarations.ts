import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustSourceCallableReturnFact } from "../../../../target-model/records/source-declarations.js";

export const rustCompileTimeSourceKey = defineRustPlanKey<true>(
  "compileTimeSource",
  (left, right) => left === right,
);

export const rustSourceCallableReturnFactKey: RustPlanKey<RustSourceCallableReturnFact> =
  defineRustPlanKey("sourceCallableReturn", (left, right) =>
    rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.borrowedParameter === right.borrowedParameter &&
    left.implementationCompletion === right.implementationCompletion &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined &&
    left.canFallThrough === right.canFallThrough);
