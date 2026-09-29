import type { TargetTypeRef } from "../types/model.js";
import { isRustProgramErrorCarrier, rustJsErrorTargetType, rustSourceTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export interface RustProgramErrorConversion {
  readonly kind: "program-error";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly variant?: string;
}

export function rustProgramErrorConversionMatches(
  conversion: RustProgramErrorConversion, source: TargetTypeRef, target: TargetTypeRef,
): boolean {
  return rustTargetTypeRefEquals(source, conversion.source) && rustTargetTypeRefEquals(target, conversion.target) &&
    isRustProgramErrorCarrier(target) && (conversion.variant === undefined
      ? rustTargetTypeRefEquals(source, rustJsErrorTargetType())
      : typeof conversion.variant === "string" && conversion.variant.length > 0 &&
        rustSourceTypeCarrierValue(source)?.shape === "object");
}
