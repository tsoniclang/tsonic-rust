import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustCallScopedLifetimeReconciliationFact,
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustProjectUpcastFact,
} from "./value-projections.js";
import {
  isRustProgramErrorCarrier,
  rustCarrierSupportsClone,
  rustCarrierSupportsTrait,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { RustProjectTypePolicy } from "./project-types.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";

export type RustValueCarrierReconciliation =
  | { readonly kind: "identity" }
  | {
      readonly kind: "call-scoped-lifetime";
      readonly fact: RustCallScopedLifetimeReconciliationFact;
    }
  | { readonly kind: "conversion"; readonly fact: RustContextualValueConversionFact }
  | { readonly kind: "project-upcast"; readonly fact: RustProjectUpcastFact }
  | { readonly kind: "incompatible"; readonly reason: "ambiguous" | "unrelated" };

export type RustAppliedValueCarrierReconciliation = Extract<
  RustValueCarrierReconciliation,
  { readonly kind: "call-scoped-lifetime" | "conversion" | "project-upcast" }
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
  const lifetimeReconciliation = selectRustCallScopedLifetimeReconciliation(
    sourceCarrier,
    targetCarrier,
  );
  if (lifetimeReconciliation !== undefined) {
    return { kind: "call-scoped-lifetime", fact: lifetimeReconciliation };
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
  const nativeTraitObjectUpcast = selectRustNativeTraitObjectUpcast(
    sourceCarrier,
    targetCarrier,
  );
  if (nativeTraitObjectUpcast !== undefined) {
    return {
      kind: "conversion",
      fact: {
        sourceCarrier,
        targetCarrier,
        conversion: nativeTraitObjectUpcast,
      },
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

export function selectRustNativeTraitObjectUpcast(
  source: TargetTypeRef,
  target: TargetTypeRef,
): Extract<
  RustContextualValueConversion,
  { readonly kind: "native-trait-object-upcast" }
> | undefined {
  if (target.kind !== "trait-object") {
    return undefined;
  }
  const traits = [target.principal, ...target.autoTraits];
  if (traits.some((trait) => trait.lifetimeBinder !== undefined ||
    trait.genericArguments.length !== 0 ||
    trait.associatedConstraints.length !== 0 ||
    !rustCarrierSupportsTrait(source, trait.path))) {
    return undefined;
  }
  return Object.freeze({
    kind: "native-trait-object-upcast",
    source,
    target,
  });
}

export function selectRustCallScopedLifetimeReconciliation(
  sourceCarrier: TargetTypeRef,
  selectedCarrier: TargetTypeRef,
): RustCallScopedLifetimeReconciliationFact | undefined {
  if (!matchesByElidingCallScopedLifetimes(selectedCarrier, sourceCarrier) &&
    !matchesByElidingCallScopedLifetimes(sourceCarrier, selectedCarrier)) {
    return undefined;
  }
  return Object.freeze({ sourceCarrier, selectedCarrier });
}

function matchesByElidingCallScopedLifetimes(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
): boolean {
  const references = rustTargetGenericReferences(pattern);
  if (references.callScopedElisions.length === 0) return false;
  const lifetimes = new Map(references.callScopedElisions.map((lifetime) => [
    rustLifetimeKey(lifetime),
    lifetime,
  ]));
  const inferred = inferRustTargetGenericBindings(
    pattern,
    actual,
    {
      typeNames: new Set(),
      lifetimeIdentities: new Set(lifetimes.keys()),
      constIdentities: new Set(),
    },
    { callScopedElisionBindings: lifetimes },
  );
  return inferred !== undefined && inferred.types.size === 0 && inferred.consts.size === 0 &&
    inferred.lifetimes.size === lifetimes.size &&
    [...lifetimes].every(([identity, lifetime]) =>
      inferred.lifetimes.get(identity)?.kind === "placeholder" ||
      rustLifetimesEqual(inferred.lifetimes.get(identity), lifetime));
}
