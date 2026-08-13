import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { RustSemanticModel } from "../../policy/model.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustContextualValueConversionFactKey,
  rustFlowReadProjectionFactKey,
  rustOptionProjectionFactKey,
  rustProjectUpcastFactKey,
} from "../rust-facts/keys.js";
import type {
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustProjectUpcastFact,
} from "../rust-facts/keys.js";
import {
  isRustProgramErrorCarrier,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
} from "../rust-target-types.js";
import type { RustProjectTypePolicy } from "./project-type-policy.js";
import { selectRustSourceValueConversion } from "../rust-facts/value-conversions.js";

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

export function recordRustFlowReadProjection(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject,
  fact: RustFlowReadProjectionFact,
): void {
  facts.set(subject, rustFlowReadProjectionFactKey, fact, [
    { message: `rust exact ${fact.kind} flow-read projection` },
  ]);
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

export function recordRustValueCarrierReconciliation(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject,
  reconciliation: RustAppliedValueCarrierReconciliation,
): void {
  if (reconciliation.kind === "project-upcast") {
    facts.set(subject, rustProjectUpcastFactKey, reconciliation.fact, [
      { message: "rust exact project-type upcast" },
    ]);
    return;
  }
  facts.set(
    subject,
    rustContextualValueConversionFactKey,
    reconciliation.fact,
    [{ message: "rust exact contextual value conversion" }],
  );
}

export function rustValueCarrierBeforeContextualConversion(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustProjectUpcastFactKey)?.targetCarrier ??
    facts.getTargetConversionFact(subject)?.convertedType ??
    facts.getFact(subject, rustFlowReadProjectionFactKey)?.selectedCarrier ??
    facts.getRuntimeCarrierFact(subject)?.carrier;
}

export function rustValueCarrierBeforeOptionProjection(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustContextualValueConversionFactKey)?.targetCarrier ??
    rustValueCarrierBeforeContextualConversion(facts, subject);
}

export function rustEffectiveValueCarrier(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustOptionProjectionFactKey)?.resultCarrier ??
    rustValueCarrierBeforeOptionProjection(facts, subject);
}

export function rustValueCarrierTransitionTarget(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  const source = facts.getRuntimeCarrierFact(subject)?.carrier;
  const effective = rustEffectiveValueCarrier(facts, subject);
  return source === undefined || effective === undefined ||
      rustTargetTypeRefEquals(source, effective)
    ? undefined
    : effective;
}
