import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../target-model/semantics/index.js";
import { rustConstSemanticKey } from "../../target-model/semantics/index.js";
import type {
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustProjectUpcastFact,
} from "./value-projections.js";
import {
  isRustProgramErrorCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { RustTraitSupportQueries } from "../../target-model/types/index.js";
import type { RustProjectTypePolicy } from "./project-types.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";

export type RustValueCarrierReconciliation =
  | { readonly kind: "identity" }
  | { readonly kind: "conversion"; readonly fact: RustContextualValueConversionFact }
  | { readonly kind: "project-upcast"; readonly fact: RustProjectUpcastFact }
  | { readonly kind: "incompatible"; readonly reason: "ambiguous" | "unrelated" };

export interface RustLifetimeRelation {
  lifetimeOutlives(longer: RustLifetimeRef, shorter: RustLifetimeRef): boolean;
}

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
  traits: RustTraitSupportQueries,
): RustFlowReadProjectionSelection {
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return { kind: "identity" };
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const selectedDefinition = projectTypes.definitionForCarrier(selectedCarrier);
    const variant = selectedDefinition === undefined
      ? undefined
      : projectTypes.programErrorVariant(selectedDefinition);
    return variant !== undefined && traits.supportsClone(selectedCarrier)
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
    return traits.supportsClone(selectedCarrier)
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
    (optionalElement !== undefined && !traits.supportsClone(dispatchCarrier))) {
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
  lifetimes: RustLifetimeRelation,
): RustValueCarrierReconciliation {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { kind: "identity" };
  }
  if (rustTargetTypeRefCanCoerce(sourceCarrier, targetCarrier, lifetimes)) {
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

export function rustTargetTypeRefCanCoerce(
  source: TargetTypeRef,
  target: TargetTypeRef,
  lifetimes: RustLifetimeRelation,
): boolean {
  if (rustTargetTypeRefEquals(source, target)) return true;
  if (source.kind !== target.kind) return false;
  switch (source.kind) {
    case "reference": {
      if (target.kind !== "reference" || source.mutable !== target.mutable ||
        !lifetimes.lifetimeOutlives(source.lifetime, target.lifetime)) {
        return false;
      }
      return source.mutable
        ? rustTargetTypeRefEquals(source.target, target.target)
        : rustTargetTypeRefCanCoerce(source.target, target.target, lifetimes);
    }
    case "tuple":
      return target.kind === "tuple" && source.elements.length === target.elements.length &&
        source.elements.every((element, index) =>
          rustTargetTypeRefCanCoerce(element, target.elements[index]!, lifetimes));
    case "array":
      return target.kind === "array" &&
        rustConstSemanticKey(source.length) === rustConstSemanticKey(target.length) &&
        rustTargetTypeRefCanCoerce(source.element, target.element, lifetimes);
    case "sequence":
    case "slice":
      return target.kind === source.kind &&
        rustTargetTypeRefCanCoerce(source.element, target.element, lifetimes);
    case "raw-pointer":
      return target.kind === "raw-pointer" && source.mutable === target.mutable &&
        (source.mutable
          ? rustTargetTypeRefEquals(source.target, target.target)
          : rustTargetTypeRefCanCoerce(source.target, target.target, lifetimes));
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "str":
    case "self":
    case "type-parameter":
    case "inference-variable":
    case "path":
    case "function-pointer":
    case "closure":
    case "trait-object":
    case "opaque":
    case "associated-type":
    case "source-carrier":
      return false;
  }
}

export function rustExplicitReferenceArgumentCanCoerce(
  source: TargetTypeRef,
  target: TargetTypeRef,
  lifetimes: RustLifetimeRelation,
): boolean {
  if (source.kind !== "reference" || target.kind !== "reference" ||
    source.mutable !== target.mutable) {
    return false;
  }
  const lifetimeIsValid = target.lifetime.kind === "inferred-region" ||
    lifetimes.lifetimeOutlives(source.lifetime, target.lifetime);
  if (!lifetimeIsValid) return false;
  if (rustTargetTypeRefEquals(source.target, target.target)) return true;
  if (isRustStringCarrier(source.target) && target.target.kind === "str") return true;
  if (target.target.kind !== "slice") return false;
  if (source.target.kind === "sequence" || source.target.kind === "array") {
    return rustTargetTypeRefEquals(source.target.element, target.target.element);
  }
  return false;
}
