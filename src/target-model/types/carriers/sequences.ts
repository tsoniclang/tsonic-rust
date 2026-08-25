import { rustJsArrayLikeElementTargetType } from "./js.js";
import type { TargetTypeRef } from "../model.js";

export function rustArrayLikeElementCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind === "sequence" || carrier?.kind === "array") {
    return carrier.element;
  }
  return rustJsArrayLikeElementTargetType(carrier);
}
