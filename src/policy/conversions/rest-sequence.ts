import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "./selection.js";
import type { RustNonOptionValueConversion } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function selectRustRestSequenceConversion(
  source: TargetTypeRef,
  elementTarget: TargetTypeRef,
  holePolicy: "reject" | "number-nan",
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): Extract<RustNonOptionValueConversion, { readonly kind: "rest-sequence" }> | undefined {
  const sequence = rustRestSequenceElements(source);
  if (sequence === undefined) return undefined;
  const conversions = sequence.elements.map(element => selectRustSourceValueConversion(element, elementTarget, definitions));
  if (conversions.some(conversion => conversion?.kind === "option-map" || conversion?.kind === "option-some")) return undefined;
  const conversion = {
    kind: "rest-sequence" as const, source, elementTarget, holePolicy,
    elementConversions: conversions.map(conversion => conversion ?? null) as readonly (RustNonOptionValueConversion | null)[],
  };
  return rustValueConversionContract(conversion, definitions) === undefined ? undefined : conversion;
}
