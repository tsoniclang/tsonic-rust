import type { RustValueConversion } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";
import { rustValueConversionIsFallible } from "./contracts.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustCarrierSupportsTrait } from "../types/carriers/traits.js";
import { rustProviderRecordCopyMatches, type RustProviderRecordCopy } from "./provider-record.js";
import { rustEmptyRecordConversionMatches, type RustEmptyRecordConversion } from "./empty-record.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";

export type RustContextualValueConversion =
  | RustValueConversion
  | RustProviderRecordCopy
  | RustEmptyRecordConversion
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
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (conversion.kind === "empty-record") {
    return rustEmptyRecordConversionMatches(conversion, sourceCarrier, targetCarrier);
  }
  if (conversion.kind === "provider-record-copy") {
    return rustProviderRecordCopyMatches(conversion, sourceCarrier, targetCarrier, definitions);
  }
  if (conversion.kind === "native-trait-object-upcast") {
    const traits = [conversion.target.principal, ...conversion.target.autoTraits];
    return rustTargetTypeRefEquals(conversion.source, sourceCarrier) &&
      rustTargetTypeRefEquals(conversion.target, targetCarrier) &&
      traits.every((trait) => trait.lifetimeBinder === undefined &&
        trait.genericArguments.length === 0 &&
        trait.associatedConstraints.length === 0 &&
        rustCarrierSupportsTrait(conversion.source, trait.path, undefined, undefined, definitions));
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
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  return conversion !== undefined &&
    conversion.kind !== "native-trait-object-upcast" &&
    conversion.kind !== "reference-reborrow" &&
    conversion.kind !== "provider-record-copy" &&
    conversion.kind !== "empty-record" &&
    rustValueConversionIsFallible(conversion, definitions);
}
