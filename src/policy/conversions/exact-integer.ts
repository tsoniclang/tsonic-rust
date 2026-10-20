import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustIntegerCarrier, isRustNumericCarrier, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustExactIntegerConversion } from "../../target-model/conversions/exact-integer.js";
export function selectRustExactIntegerConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustExactIntegerConversion | undefined {
  const conversion = { kind: "exact-integer" as const, source, target };
  return rustExactIntegerConversionMatches(source, target, conversion) ? conversion : undefined;
}

export function rustExactIntegerConversionMatches(
  source: TargetTypeRef,
  target: TargetTypeRef,
  conversion: RustExactIntegerConversion,
): boolean {
  const sourceElement = rustOptionElementCarrier(source);
  const targetElement = rustOptionElementCarrier(target);
  return (sourceElement === undefined || targetElement !== undefined) &&
    isRustNumericCarrier(sourceElement ?? source) && isRustIntegerCarrier(targetElement ?? target) &&
    rustTargetTypeRefEquals(source, conversion.source) &&
    rustTargetTypeRefEquals(target, conversion.target) &&
    !rustTargetTypeRefEquals(source, target);
}
