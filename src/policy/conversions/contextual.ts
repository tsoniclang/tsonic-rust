import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustValueConversionContract, rustValueConversionIsFallible } from "../../target-model/conversions/contracts.js";
import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCarrierSupportsTrait } from "../../target-model/types/carriers/traits.js";
import { rustProviderRecordCopyMatches } from "../../target-model/conversions/provider-record.js";
import { rustEmptyRecordConversionMatches } from "../../target-model/conversions/empty-record.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustGenericCallableConversionMatches } from "../../target-model/conversions/generic-callable.js";
import { rustIntegerTruncationConversionMatches } from "../../target-model/conversions/integer-truncation.js";
import { rustExactIntegerConversionMatches } from "../../target-model/conversions/exact-integer.js";

import { rustCallableConversionMatches } from "./callable.js";
import { rustProjectUnionMapConversionMatches, type RustProjectUpcastRelation } from "../../target-model/conversions/project-union.js";

import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
export function rustContextualRuntimeConversionContract(
  conversion: RustContextualValueConversion,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversionContract | undefined {
  switch (conversion.kind) {
    case "native-trait-object-upcast":
    case "reference-reborrow":
    case "provider-record-copy":
    case "empty-record":
    case "generic-callable-flow":
    case "integer-truncation":
    case "callable-adapter":
    case "project-union-map":
      return undefined;
    default:
      return rustValueConversionContract(conversion, definitions);
  }
}

export function rustCompilerOwnedContextualConversionMatches(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  conversion: RustContextualValueConversion,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  projectUpcastRelation?: RustProjectUpcastRelation,
): boolean {
  if (conversion.kind === "project-union-map") {
    return rustProjectUnionMapConversionMatches(conversion, sourceCarrier, targetCarrier, definitions, projectUpcastRelation);
  }
  if (conversion.kind === "callable-adapter") return rustCallableConversionMatches(conversion, sourceCarrier, targetCarrier, definitions);
  if (conversion.kind === "exact-integer") {
    return rustExactIntegerConversionMatches(sourceCarrier, targetCarrier, conversion);
  }
  if (conversion.kind === "integer-refinement") {
    const contract = rustValueConversionContract(conversion, definitions);
    return contract !== undefined && rustTargetTypeRefEquals(contract.source, sourceCarrier) &&
      rustTargetTypeRefEquals(contract.target, targetCarrier);
  }
  if (conversion.kind === "integer-truncation") {
    return rustIntegerTruncationConversionMatches(sourceCarrier, targetCarrier, conversion);
  }
  if (conversion.kind === "generic-callable-flow") {
    return rustGenericCallableConversionMatches(conversion, sourceCarrier, targetCarrier);
  }
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
  if (conversion?.kind === "provider-record-copy") {
    return conversion.fields.some(field => rustValueConversionIsFallible(field.conversion, definitions));
  }
  return conversion !== undefined &&
    conversion.kind !== "project-union-map" &&
    conversion.kind !== "native-trait-object-upcast" &&
    conversion.kind !== "reference-reborrow" &&
    conversion.kind !== "empty-record" &&
    conversion.kind !== "generic-callable-flow" &&
    conversion.kind !== "integer-truncation" &&
    conversion.kind !== "callable-adapter" &&
    rustValueConversionIsFallible(conversion, definitions);
}
