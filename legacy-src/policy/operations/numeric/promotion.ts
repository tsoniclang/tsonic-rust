import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import {
  isRustIntegerCarrier,
  isRustNumericCarrier,
  rustSourcePrimitiveTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustNumericPromotionKind } from "../../../target-model/conversions/numeric-promotion.js";

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

export function selectRustNumericComparisonPromotion(
  left: TargetTypeRef,
  right: TargetTypeRef,
): RustNumericBinaryPromotion | undefined {
  const ordinary = selectRustNumericBinaryPromotion(left, right);
  if (ordinary !== undefined) return ordinary;
  if (!isRustIntegerCarrier(left) || !isRustIntegerCarrier(right)) return undefined;
  const leftConversion = rustNumericPromotionConversion(left.name, "int128");
  const rightConversion = rustNumericPromotionConversion(right.name, "int128");
  if (leftConversion === undefined || rightConversion === undefined) return undefined;
  return { carrier: rustSourcePrimitiveTargetType("int128"), leftConversion, rightConversion };
}
