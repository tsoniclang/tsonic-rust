import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustUnionArmMapping, rustUnionProjectionContract, rustUnionLeaves } from "../../target-model/types/union-relations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustCallScopedLifetimeReconciliationFact,
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustProjectUpcastFact,
} from "./value-projections.js";
import {
  isRustProgramErrorCarrier,
  isRustJsValueCarrier,
  rustJsErrorTargetType,
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
import { rustEmptyRecordCarrier } from "../../target-model/conversions/empty-record.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { selectRustProjectProjection } from "./project-projections.js";
import { rustGenericCallableSignaturesMatch } from "../../target-model/conversions/generic-callable.js";
import { selectRustCallableConversion } from "../../target-model/conversions/callable.js";

export type RustValueCarrierReconciliation =
  | { readonly kind: "identity" }
  | {
      readonly kind: "call-scoped-lifetime";
      readonly fact: RustCallScopedLifetimeReconciliationFact;
    }
  | { readonly kind: "conversion"; readonly fact: RustContextualValueConversionFact; readonly upcast?: RustProjectUpcastFact }
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
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustFlowReadProjectionSelection {
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return { kind: "identity" };
  }
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const union = definitions.sourceUnionVariants(dispatchCarrier);
  const selectedPayload = rustOptionElementCarrier(selectedCarrier);
  const mapping = rustTargetTypeRefEquals(dispatchCarrier, selectedPayload ?? selectedCarrier) ? undefined
    : selectRustUnionArmMapping(dispatchCarrier, selectedPayload ?? selectedCarrier, "target", definitions);
  if (mapping !== undefined) {
    return selectedPayload !== undefined && rustOptionElementCarrier(sourceCarrier) === undefined
      ? { kind: "incompatible" }
      : { kind: "projection", fact: { kind: "union-map", sourceCarrier, dispatchCarrier, selectedCarrier, arms: mapping } };
  }
  const unionProjection = rustUnionProjectionContract(sourceCarrier, selectedCarrier, definitions);
  if (unionProjection !== undefined) {
    return { kind: "projection", fact: { kind: union === undefined ? "runtime-union" : "source-union",
      sourceCarrier, dispatchCarrier, selectedCarrier, variant: unionProjection.variant.name } };
  }
  if (selectedPayload === undefined) {
    const candidates = rustUnionLeaves(dispatchCarrier, definitions)?.flatMap(leaf => {
      const projection = selectRustProjectProjection(leaf.carrier, selectedCarrier, projectTypes);
      return projection === undefined ? [] : [{ leaf, projection }];
    });
    if (candidates?.length === 1) {
      const { leaf, projection } = candidates[0]!;
      return { kind: "projection", fact: {
        kind: union === undefined ? "runtime-union" : "source-union",
        sourceCarrier, dispatchCarrier, selectedCarrier, variant: leaf.path[leaf.path.length - 1]!.variant.name,
        project: { sourceCarrier: leaf.carrier, dispatchCarrier: leaf.carrier,
          targetCarrier: selectedCarrier, projection },
      } };
    }
  }
  if ((isRustJsValueCarrier(sourceCarrier) || isRustProgramErrorCarrier(sourceCarrier) &&
    projectTypes.builtinErrorProjectionAvailable === true) &&
    rustTargetTypeRefEquals(selectedCarrier, rustJsErrorTargetType())) {
    return { kind: "projection", fact: { kind: "builtin-error", sourceCarrier, selectedCarrier } };
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const selectedDefinition = projectTypes.definitionForCarrier(selectedCarrier);
    const variant = selectedDefinition === undefined
      ? undefined
      : projectTypes.programErrorVariant(selectedDefinition);
    return variant !== undefined && rustCarrierSupportsClone(selectedCarrier, definitions)
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
    if (selectedCarrier.kind === "reference" && selectedCarrier.mutable) {
      return { kind: "projection", fact: { kind: "option-reference", sourceCarrier, selectedCarrier } };
    }
    return { kind: "projection", fact: { kind: "option-value", sourceCarrier, selectedCarrier } };
  }
  const sourceDefinition = projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = projectTypes.definitionForCarrier(selectedCarrier);
  const relationship = sourceDefinition === undefined || targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : projectTypes.relationship(selectedCarrier, sourceDefinition);
  const projection = selectRustProjectProjection(dispatchCarrier, selectedCarrier, projectTypes);
  if (projection === undefined ||
    (projection.kind !== "structural" && (relationship.kind !== "related" ||
      !rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier))) ||
    (optionalElement !== undefined && !rustCarrierSupportsClone(dispatchCarrier, definitions))) {
    return { kind: "incompatible" };
  }
  return {
    kind: "projection",
    fact: {
      kind: "project-downcast",
      projection,
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
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueCarrierReconciliation {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { kind: "identity" };
  }
  if (isRustProgramErrorCarrier(targetCarrier)) {
    const definition = projectTypes.definitionForCarrier(sourceCarrier);
    const variant = definition === undefined ? undefined : projectTypes.programErrorVariant(definition);
    if (rustTargetTypeRefEquals(sourceCarrier, rustJsErrorTargetType()) || definition !== undefined &&
      variant !== undefined && rustTargetTypeRefEquals(projectTypes.openCarrier(definition), sourceCarrier)) {
      return { kind: "conversion", fact: { sourceCarrier, targetCarrier, conversion: {
        kind: "program-error", source: sourceCarrier, target: targetCarrier,
        ...(variant === undefined ? {} : { variant }),
      } } };
    }
  }
  if (rustGenericCallableSignaturesMatch(sourceCarrier, targetCarrier)) {
    return { kind: "conversion", fact: { sourceCarrier, targetCarrier,
      conversion: { kind: "generic-callable-flow", source: sourceCarrier, target: targetCarrier },
    } };
  }
  const callable = selectRustCallableConversion(sourceCarrier, targetCarrier,
    (source, target) => selectRustSourceValueConversion(source, target, definitions), definitions);
  if (callable !== undefined) {
    return { kind: "conversion", fact: { sourceCarrier, targetCarrier,
      conversion: callable,
    } };
  }
  if (rustEmptyRecordCarrier(sourceCarrier) && rustEmptyRecordCarrier(targetCarrier)) {
    return { kind: "conversion", fact: {
      sourceCarrier, targetCarrier,
      conversion: { kind: "empty-record", source: sourceCarrier, target: targetCarrier },
    } };
  }
  const lifetimeReconciliation = selectRustCallScopedLifetimeReconciliation(
    sourceCarrier,
    targetCarrier,
  );
  if (lifetimeReconciliation !== undefined) {
    return { kind: "call-scoped-lifetime", fact: lifetimeReconciliation };
  }
  const targetDefinition = projectTypes.definitionForCarrier(targetCarrier);
  const sourceVariants = definitions.sourceUnionVariants(sourceCarrier);
  if (targetDefinition !== undefined && sourceVariants !== undefined && sourceVariants.length > 0) {
    for (const variant of sourceVariants) {
      const relationship = projectTypes.relationship(variant.carrier, targetDefinition);
      if (relationship.kind === "ambiguous") return { kind: "incompatible", reason: "ambiguous" };
      if (relationship.kind !== "related" ||
        !rustTargetTypeRefEquals(relationship.targetType, targetCarrier)) {
        return { kind: "incompatible", reason: "unrelated" };
      }
    }
    return { kind: "project-upcast", fact: { sourceCarrier, targetCarrier, sourceVariants } };
  }
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
    definitions,
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
  const conversion = selectRustSourceValueConversion(sourceCarrier, targetCarrier, definitions);
  if (conversion !== undefined) return { kind: "conversion", fact: { sourceCarrier, targetCarrier, conversion } };
  const candidates: { readonly upcast: RustProjectUpcastFact; readonly fact: RustContextualValueConversionFact }[] = [];
  for (const arm of rustUnionLeaves(targetCarrier, definitions) ?? []) {
    if (arm.path[arm.path.length - 1]?.variant.kind !== "payload") continue;
    const definition = projectTypes.definitionForCarrier(arm.carrier);
    if (definition === undefined) continue;
    const relationship = projectTypes.relationship(sourceCarrier, definition);
    if (relationship.kind === "ambiguous") return { kind: "incompatible", reason: "ambiguous" };
    if (relationship.kind !== "related" || !rustTargetTypeRefEquals(relationship.targetType, arm.carrier)) continue;
    const injection = selectRustSourceValueConversion(arm.carrier, targetCarrier, definitions);
    if (injection?.kind !== "source-union-variant") continue;
    candidates.push({ upcast: { sourceCarrier, targetCarrier: arm.carrier },
      fact: { sourceCarrier: arm.carrier, targetCarrier, conversion: injection } });
  }
  return candidates.length === 1 ? { kind: "conversion", ...candidates[0]! }
    : { kind: "incompatible", reason: candidates.length > 1 ? "ambiguous" : "unrelated" };
}

export function selectRustNativeTraitObjectUpcast(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
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
    !rustCarrierSupportsTrait(source, trait.path, undefined, undefined, definitions))) {
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
      typeIdentities: new Set(),
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
