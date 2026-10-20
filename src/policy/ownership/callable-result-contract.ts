import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNumericValueConversionIsSupported } from "../conversions/numeric-promotion.js";
import { rustNativeRepresentationMatches } from "../conversions/native-representation.js";

export function rustNativeCallableResultMatches(source: TargetTypeRef, declared: TargetTypeRef): boolean {
  return rustTargetTypeRefEquals(source, declared) || rustNativeRepresentationMatches(source, declared) ||
    source.kind === "source-primitive" && declared.kind === "source-primitive" &&
      rustNumericValueConversionIsSupported(source.name, declared.name);
}
