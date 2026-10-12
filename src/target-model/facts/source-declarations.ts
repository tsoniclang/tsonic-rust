import { defineRustPlanKey } from "./keys.js";
import type { RustPlanKey } from "./keys.js";
import type { TargetTypeRef } from "../types/model.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import type { Node } from "@tsonic/tsts";

export const rustCompileTimeSourceKey = defineRustPlanKey<true>(
  "compileTimeSource",
  (left, right) => left === right,
);

export interface RustSourceCallableReturnFact {
  readonly returnCarrier: TargetTypeRef;
  readonly borrowedParameter?: Node;
  readonly implementationCompletion?: "absence" | "diverging";
  readonly canFallThrough?: boolean;
  readonly undefinedReturn?: boolean;
  readonly fallthroughUndefined?: boolean;
}

export const rustSourceCallableReturnFactKey: RustPlanKey<RustSourceCallableReturnFact> =
  defineRustPlanKey("sourceCallableReturn", (left, right) =>
    rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.borrowedParameter === right.borrowedParameter &&
    left.implementationCompletion === right.implementationCompletion &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined &&
    left.canFallThrough === right.canFallThrough);
