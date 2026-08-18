import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustValueConversion } from "./model.js";
import {
  isRustNumericCarrier,
  rustSourcePrimitiveTargetType,
} from "../types/target-types.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustNumericPromotionKind } from "./numeric-promotion-model.js";

export interface RustNumericBinaryPromotion {
  readonly carrier: TargetTypeRef;
  readonly leftConversion?: RustValueConversion;
  readonly rightConversion?: RustValueConversion;
}

export function selectRustNumericBinaryPromotion(
  left: TargetTypeRef,
  right: TargetTypeRef,
): RustNumericBinaryPromotion | undefined {
  if (!isRustNumericCarrier(left) || !isRustNumericCarrier(right)) {
    return undefined;
  }
  const promotedKind = rustNumericPromotionKind(left.name, right.name);
  if (promotedKind === undefined) {
    return undefined;
  }
  const carrier = rustSourcePrimitiveTargetType(promotedKind);
  return {
    carrier,
    leftConversion: rustTargetTypeRefEquals(left, carrier)
      ? undefined
      : rustNumericPromotionConversion(left.name, promotedKind),
    rightConversion: rustTargetTypeRefEquals(right, carrier)
      ? undefined
      : rustNumericPromotionConversion(right.name, promotedKind),
  };
}

export function rustNumericPromotionConversion(
  source: SourcePrimitiveKind,
  target: SourcePrimitiveKind,
): RustValueConversion | undefined {
  return source !== target && rustNumericPromotionKind(source, target) === target
    ? { kind: "numeric-promotion", source, target }
    : undefined;
}
