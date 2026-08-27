import type { RustValueConversion } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";
import { rustValueConversionIsFallible } from "./contracts.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustCarrierSupportsTrait } from "../types/carriers/traits.js";

export type RustContextualValueConversion =
  | RustValueConversion
  | {
      readonly kind: "native-trait-object-upcast";
      readonly source: TargetTypeRef;
      readonly target: Extract<TargetTypeRef, { readonly kind: "trait-object" }>;
    }
  | {
      readonly kind: "reference-reborrow";
      readonly source: Extract<TargetTypeRef, { readonly kind: "reference" }>;
      readonly target: TargetTypeRef;
    };

export function rustCompilerOwnedContextualConversionMatches(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  conversion: RustContextualValueConversion,
): boolean {
  if (conversion.kind === "native-trait-object-upcast") {
    const traits = [conversion.target.principal, ...conversion.target.autoTraits];
    return rustTargetTypeRefEquals(conversion.source, sourceCarrier) &&
      rustTargetTypeRefEquals(conversion.target, targetCarrier) &&
      traits.every((trait) => trait.lifetimeBinder === undefined &&
        trait.genericArguments.length === 0 &&
        trait.associatedConstraints.length === 0 &&
        rustCarrierSupportsTrait(conversion.source, trait.path));
  }
  if (conversion.kind === "reference-reborrow") {
    return rustTargetTypeRefEquals(conversion.source, sourceCarrier) &&
      rustTargetTypeRefEquals(conversion.target, targetCarrier) &&
      rustTargetTypeRefEquals(conversion.source.referent, conversion.target);
  }
  return false;
}

export function rustContextualValueConversionIsFallible(
  conversion: RustContextualValueConversion | undefined,
): boolean {
  return conversion !== undefined &&
    conversion.kind !== "native-trait-object-upcast" &&
    conversion.kind !== "reference-reborrow" &&
    rustValueConversionIsFallible(conversion);
}
