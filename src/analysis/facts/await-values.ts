import { defineRustPlanKey, type RustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals, hasExactObjectKeys, isClosedMetadata, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustUnitCarrier } from "../../target-model/types/carriers/js.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { mapRustAwaitSelection, rustAwaitSelection, type RustAwaitSelection } from "../../target-model/types/await.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { RustFinalizedValueConversion } from "./finalized-operation/model.js";
import type { RustFutureValueFact } from "./keys.js";
import { finalizedConversionIsValid, finalizeValueConversion } from "./finalized-operation/conversions.js";
import { rustFutureValueMatchesCarrier } from "./future-values.js";

export interface RustAwaitValueLeafFact {
  readonly carrier: TargetTypeRef;
  readonly future?: RustFutureValueFact;
  readonly completion: { readonly kind: "absence" } |
    { readonly kind: "value"; readonly conversion: RustFinalizedValueConversion };
}

export interface RustAwaitValueFact {
  readonly operandCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly selection: RustAwaitSelection<RustAwaitValueLeafFact>;
}

export const rustAwaitValueFactKey: RustPlanKey<RustAwaitValueFact> = defineRustPlanKey("awaitValue", closedMetadataEquals);

function admitsAbsentCompletion(carrier: TargetTypeRef): boolean {
  return isRustUnitCarrier(carrier) || rustOptionElementCarrier(carrier) !== undefined || rustOptionalStorageValue(carrier) !== undefined;
}

export function finalizeRustAwaitValueFact(
  operandCarrier: TargetTypeRef,
  resultCarrier: TargetTypeRef,
  futureFor: (carrier: TargetTypeRef) => RustFutureValueFact | undefined,
  selectConversion: (source: TargetTypeRef, target: TargetTypeRef) => RustValueConversion | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustAwaitValueFact | undefined {
  const topology = rustAwaitSelection(operandCarrier, definitions);
  if (topology === undefined) return undefined;
  const selection = mapRustAwaitSelection(topology, leaf => {
    const future = leaf.future === undefined ? undefined : futureFor(leaf.carrier);
    if (leaf.future !== undefined && (future === undefined ||
      !rustFutureValueMatchesCarrier(future, leaf.carrier, definitions))) return undefined;
    const output = future?.outputCarrier ?? leaf.carrier;
    const completion = isRustUnitCarrier(output) && !rustTargetTypeRefEquals(output, resultCarrier) && admitsAbsentCompletion(resultCarrier)
      ? { kind: "absence" as const }
      : undefined;
    const conversion = completion !== undefined ? undefined : finalizeValueConversion(
      rustTargetTypeRefEquals(output, resultCarrier) ? undefined : selectConversion(output, resultCarrier),
      output, resultCarrier, definitions);
    return completion === undefined && conversion === undefined ? undefined : {
      carrier: leaf.carrier, ...(future === undefined ? {} : { future }),
      completion: completion ?? { kind: "value" as const, conversion: conversion! },
    };
  });
  const fact = selection === undefined ? undefined : { operandCarrier, resultCarrier, selection };
  return fact === undefined || !rustAwaitValueMatchesCarrier(fact, operandCarrier, resultCarrier, definitions)
    ? undefined : snapshotClosedMetadata(fact);
}

export function rustAwaitValueMatchesCarrier(
  fact: RustAwaitValueFact,
  operandCarrier: TargetTypeRef | undefined,
  resultCarrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (operandCarrier === undefined || resultCarrier === undefined || !isClosedMetadata(fact) ||
    !hasExactObjectKeys(fact, ["operandCarrier", "resultCarrier", "selection"]) ||
    !rustTargetTypeRefEquals(fact.operandCarrier, operandCarrier) ||
    !rustTargetTypeRefEquals(fact.resultCarrier, resultCarrier)) return false;
  const topology = rustAwaitSelection(operandCarrier, definitions);
  if (topology === undefined) return false;
  const validate = (expected: RustAwaitSelection, selected: RustAwaitSelection<RustAwaitValueLeafFact>): boolean => {
    if (selected === null || typeof selected !== "object" || expected.kind !== selected.kind) return false;
    if (expected.kind === "leaf" && selected.kind === "leaf") {
      if (!hasExactObjectKeys(selected, ["kind", "value"])) return false;
      const leaf = selected.value;
      if (leaf === null || typeof leaf !== "object" || !hasExactObjectKeys(leaf,
        leaf.future === undefined ? ["carrier", "completion"] : ["carrier", "completion", "future"]) ||
        !rustTargetTypeRefEquals(expected.value.carrier, leaf.carrier) ||
        (expected.value.future === undefined) !== (leaf.future === undefined) ||
        leaf.future !== undefined && !rustFutureValueMatchesCarrier(leaf.future, leaf.carrier, definitions)) return false;
      const output = leaf.future?.outputCarrier ?? leaf.carrier;
      const completion = leaf.completion;
      if (completion === null || typeof completion !== "object") return false;
      if (completion.kind === "absence") return hasExactObjectKeys(completion, ["kind"]) &&
        isRustUnitCarrier(output) && admitsAbsentCompletion(resultCarrier);
      return completion.kind === "value" && hasExactObjectKeys(completion, ["kind", "conversion"]) &&
        finalizedConversionIsValid(completion.conversion, definitions) &&
        rustTargetTypeRefEquals(completion.conversion.sourceCarrier, output) &&
        rustTargetTypeRefEquals(completion.conversion.targetCarrier, resultCarrier);
    }
    if (expected.kind === "optional" && selected.kind === "optional") return (
      hasExactObjectKeys(selected, ["kind", "carrier", "present"]) &&
      rustTargetTypeRefEquals(expected.carrier, selected.carrier) && admitsAbsentCompletion(resultCarrier) &&
      validate(expected.present, selected.present));
    if (expected.kind !== "union" || selected.kind !== "union" ||
      !hasExactObjectKeys(selected, ["kind", "carrier", "alternatives"]) ||
      !rustTargetTypeRefEquals(expected.carrier, selected.carrier) ||
      !Array.isArray(selected.alternatives) || expected.alternatives.length !== selected.alternatives.length) return false;
    return expected.alternatives.every((alternative, index) => {
      const chosen = selected.alternatives[index];
      return chosen !== undefined && hasExactObjectKeys(chosen, ["variant", "selection"]) &&
        closedMetadataEquals(alternative.variant, chosen.variant) && validate(alternative.selection, chosen.selection);
    });
  };
  return validate(topology, fact.selection);
}
