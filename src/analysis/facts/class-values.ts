import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export interface RustClassValueFact {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly carrier: TargetTypeRef;
}

export const rustClassValueFactKey = defineRustPlanKey<RustClassValueFact>(
  "classValue",
  (left, right) => left.declaration === right.declaration &&
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.carrier, right.carrier),
);
