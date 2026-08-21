import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustProjectUpcastFact,
} from "./value-projections.js";
import {
  isRustProgramErrorCarrier,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { RustProjectTypePolicy } from "./project-types.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";

export type RustValueCarrierReconciliation =
  | { readonly kind: "identity" }
  | { readonly kind: "conversion"; readonly fact: RustContextualValueConversionFact }
  | { readonly kind: "project-upcast"; readonly fact: RustProjectUpcastFact }
  | { readonly kind: "incompatible"; readonly reason: "ambiguous" | "unrelated" };

export type RustAppliedValueCarrierReconciliation = Extract<
  RustValueCarrierReconciliation,
  { readonly kind: "conversion" | "project-upcast" }
>;

export type RustFlowReadProjectionSelection =
  | { readonly kind: "identity" }
  | { readonly kind: "projection"; readonly fact: RustFlowReadProjectionFact }
  | { readonly kind: "incompatible" };

export function selectRustFlowReadProjection(
  sourceCarrier: TargetTypeRef,
  selectedCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): RustFlowReadProjectionSelection {
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return { kind: "identity" };
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const selectedDefinition = projectTypes.definitionForCarrier(selectedCarrier);
    const variant = selectedDefinition === undefined
      ? undefined
      : projectTypes.programErrorVariant(selectedDefinition);
    return variant !== undefined && rustCarrierSupportsClone(selectedCarrier)
      ? {
          kind: "projection",
          fact: {
            kind: "program-error-variant",
            sourceCarrier,
            selectedCarrier,
            variant,
          },
        }
      : { kind: "incompatible" };
  }
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (optionalElement !== undefined &&
    rustTargetTypeRefEquals(optionalElement, selectedCarrier)) {
    return rustCarrierSupportsClone(selectedCarrier)
      ? {
          kind: "projection",
          fact: { kind: "option-value", sourceCarrier, selectedCarrier },
        }
      : { kind: "incompatible" };
  }
  const dispatchCarrier = optionalElement ?? sourceCarrier;
  const sourceDefinition = projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = projectTypes.definitionForCarrier(selectedCarrier);
  const relationship = sourceDefinition === undefined || targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : projectTypes.relationship(selectedCarrier, sourceDefinition);
  const route = sourceDefinition === undefined
    ? undefined
    : projectTypes.downcastRoute(sourceDefinition, selectedCarrier);
  if (relationship.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier) ||
    route === undefined ||
    (optionalElement !== undefined && !rustCarrierSupportsClone(dispatchCarrier))) {
    return { kind: "incompatible" };
  }
  return {
    kind: "projection",
    fact: {
      kind: "project-downcast",
      sourceCarrier,
      dispatchCarrier,
      selectedCarrier,
    },
  };
}

export function selectRustValueCarrierReconciliation(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): RustValueCarrierReconciliation {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { kind: "identity" };
  }
  const targetDefinition = projectTypes.definitionForCarrier(targetCarrier);
  const relationship = targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : projectTypes.relationship(sourceCarrier, targetDefinition);
  if (relationship.kind === "ambiguous") {
    return { kind: "incompatible", reason: "ambiguous" };
  }
  if (relationship.kind === "related" &&
    rustTargetTypeRefEquals(relationship.targetType, targetCarrier)) {
    return {
      kind: "project-upcast",
      fact: { sourceCarrier, targetCarrier },
    };
  }
  const conversion = selectRustSourceValueConversion(sourceCarrier, targetCarrier);
  return conversion === undefined
    ? { kind: "incompatible", reason: "unrelated" }
    : {
        kind: "conversion",
        fact: { sourceCarrier, targetCarrier, conversion },
      };
}
