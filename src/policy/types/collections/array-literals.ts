import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustJsArrayTargetType, rustVecTargetType } from "../../../target-model/types/index.js";

export function rustArrayLiteralCarrier(element: TargetTypeRef, lane: "native" | "js"): TargetTypeRef {
  return lane === "js" ? rustJsArrayTargetType(element) : rustVecTargetType(element);
}
