import { sourceIntegerTruncationFits } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../types/model.js";
import { isRustBigIntCarrier } from "../types/index.js";

export interface RustIntegerTruncationConversion {
  readonly kind: "integer-truncation";
  readonly width: number;
  readonly signed: boolean;
}

export function rustIntegerTruncationConversionMatches(
  source: TargetTypeRef,
  target: TargetTypeRef,
  conversion: RustIntegerTruncationConversion,
): boolean {
  return isRustBigIntCarrier(source) && target.kind === "source-primitive" &&
    sourceIntegerTruncationFits(conversion.width, conversion.signed, target.name);
}
