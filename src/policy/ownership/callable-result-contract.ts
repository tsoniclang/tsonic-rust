import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNumericValueConversionIsSupported } from "../../target-model/conversions/numeric-promotion.js";

export function rustNativeCallableResultMatches(source: TargetTypeRef, declared: TargetTypeRef): boolean {
  return rustTargetTypeRefEquals(source, declared) ||
    source.kind === "source-primitive" && declared.kind === "source-primitive" &&
      rustNumericValueConversionIsSupported(source.name, declared.name);
}
