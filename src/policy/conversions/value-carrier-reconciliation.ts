import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCarrierWithTargetPlaceholderLifetimes } from "../../target-model/types/placeholder-lifetimes.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { selectRustUnionArmMapping, rustUnionProjectionContract } from "./union-relations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallScopedLifetimeReconciliationFact, RustContextualValueConversionFact, RustFlowReadProjectionFact, RustProjectUpcastFact } from "../../target-model/records/objects/value-projections.js";
import { isRustProgramErrorCarrier, rustJsErrorTargetType, rustOptionElementCarrier, rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/index.js";
import { rustCarrierSupportsClone, rustCarrierSupportsTrait } from "../constraints/native-traits.js";
import { rustCallableTargetId, rustOptionTargetId, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../target-model/types/carriers/source-types.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { selectRustSourceValueConversion } from "./selection.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { rustEmptyRecordCarrier } from "./empty-record.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { selectRustProjectProjection } from "../types/project/project-projections.js";
import { rustGenericCallableSignaturesMatch } from "./generic-callable.js";
import { selectRustCallableConversion } from "./callable.js";
import { rustCallableConversionSource } from "../../target-model/conversions/callable-physical.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustReadonlySourceErrorCarrier, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { selectRustProjectUnionMapping } from "../types/project/project-union-mappings.js";
import { selectRustProjectTypeTestPlan } from "../operations/operators/type-tests.js";

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
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (optionalElement !== undefined && rustTargetTypeRefEquals(optionalElement, selectedCarrier)) {
    return { kind: "projection", fact: {
      kind: selectedCarrier.kind === "reference" && selectedCarrier.mutable ? "option-reference" : "option-value",
      sourceCarrier, selectedCarrier,
    } };
  }
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
  if ((isRustClosedValueCarrier(sourceCarrier) && (isRustSourceErrorCarrier(selectedCarrier) || isRustRetainedErrorCarrier(selectedCarrier)) ||
    (isRustProgramErrorCarrier(sourceCarrier) || isRustSourceErrorCarrier(sourceCarrier) || isRustRetainedErrorCarrier(sourceCarrier)) &&
    (isRustSourceErrorCarrier(selectedCarrier) && (isRustSourceErrorCarrier(projectTypes.sourceErrorCarrier()) ||
      projectTypes.sourceCreatedErrorOrigins.length !== 0 || isRustReadonlySourceErrorCarrier(selectedCarrier) &&
        rustTargetTypeRefEquals(projectTypes.sourceErrorCarrier(), rustJsErrorTargetType())) || isRustMutableJsErrorCarrier(selectedCarrier) ||
      rustTargetTypeRefEquals(selectedCarrier, rustJsErrorTargetType())))) {
    return { kind: "projection", fact: { kind: "builtin-error", sourceCarrier, selectedCarrier } };
  }
  if (selectRustProjectTypeTestPlan(sourceCarrier, selectedCarrier, projectTypes)?.lowering.kind === "closed-native" &&
    rustCarrierSupportsClone(selectedCarrier, definitions)) {
    return { kind: "projection", fact: { kind: "closed-native", sourceCarrier, selectedCarrier } };
  }
  if (isRustProgramErrorCarrier(dispatchCarrier) || isRustSourceErrorCarrier(dispatchCarrier) ||
    isRustRetainedErrorCarrier(dispatchCarrier) || isRustClosedValueCarrier(dispatchCarrier)) {
    const selectedDefinition = projectTypes.definitionForCarrier(selectedCarrier);
    const variant = selectedDefinition === undefined
      ? undefined
      : projectTypes.programErrorVariant(selectedDefinition);
    return variant !== undefined && (!(isRustSourceErrorCarrier(dispatchCarrier) || isRustRetainedErrorCarrier(dispatchCarrier) ||
      isRustClosedValueCarrier(dispatchCarrier)) ||
      selectedDefinition !== undefined && projectTypes.sourceErrorDefinitions.includes(selectedDefinition)) &&
      rustCarrierSupportsClone(selectedCarrier, definitions)
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

/**
 * A callable target whose lifetime is still a placeholder takes the concrete lifetime of the callable value flowing into
 * it; an optional callable target takes it from the present (or optional) callable value.
 */
export function rustCallableTargetForSourceLifetime(sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef): TargetTypeRef {
  if (targetCarrier.kind === "target-named" && targetCarrier.id === rustOptionTargetId) {
    const element = rustOptionElementCarrier(targetCarrier);
    const sourceElement = sourceCarrier.kind === "target-named" && sourceCarrier.id === rustOptionTargetId
      ? rustOptionElementCarrier(sourceCarrier) : sourceCarrier;
    const selected = element === undefined || sourceElement === undefined ? undefined
      : rustCallableTargetForSourceLifetime(sourceElement, element);
    return selected === undefined || selected === element ? targetCarrier
      : { ...targetCarrier, genericArguments: [{ kind: "type", type: selected }] };
  }
  // A structural parameter takes the concrete method lifetimes of the structural value passed, field by field.
  const sourceObject = rustStructuralObjectCarrierValue(sourceCarrier);
  const targetObject = rustStructuralObjectCarrierValue(targetCarrier);
  if (sourceObject !== undefined && targetObject !== undefined) {
    if (sourceObject.fields.length !== targetObject.fields.length) return targetCarrier;
    let changed = false;
    const fields = targetObject.fields.map((field, index) => {
      const source = sourceObject.fields[index]!;
      if (source.sourceName !== field.sourceName) return field;
      const type = rustCallableTargetForSourceLifetime(source.type, field.type);
      if (type === field.type) return field;
      changed = true;
      return { ...field, type };
    });
    return changed ? rustStructuralObjectTargetType(targetObject.ownerFileName, fields, targetObject.representation,
      targetObject.construction, targetObject.bases, targetObject.implementation) : targetCarrier;
  }
  const sourceCallable = rustCallableConversionSource(sourceCarrier);
  const targetCallable = rustCallableProtocol(targetCarrier);
  return targetCarrier.kind === "target-named" && targetCarrier.id === rustCallableTargetId &&
    targetCallable?.lifetime?.kind === "placeholder" && sourceCallable?.lifetime !== undefined &&
    sourceCallable.lifetime.kind !== "placeholder"
    ? rustCallableTargetType(targetCallable.parameters, targetCallable.result, sourceCallable.lifetime, targetCallable.error)
    : targetCarrier;
}

export function selectRustValueCarrierReconciliation(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueCarrierReconciliation {
  targetCarrier = rustCallableTargetForSourceLifetime(sourceCarrier, targetCarrier);
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
  if (rustTargetTypeRefEquals(rustCarrierWithTargetPlaceholderLifetimes(sourceCarrier, targetCarrier), targetCarrier)) {
    return { kind: "identity" };
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
  const projectMapping = selectRustProjectUnionMapping(sourceCarrier, targetCarrier, projectTypes, definitions);
  if (projectMapping !== undefined) return { kind: "conversion", fact: { sourceCarrier, targetCarrier, conversion: projectMapping } };
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
