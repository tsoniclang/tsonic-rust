import { rustGenericRequirementBound, type RustGenericRequirement } from "../../../target-model/lifetimes/model.js";
import type { RustLifetimeRef, RustSourceGenericParameterContract } from "../../../target-model/lifetimes/index.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import type { RustGenericParameter, RustGenerics, RustTypeBound, RustWherePredicate } from "../../target-ast/syntax/nodes.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustBuiltInCarrierDefinitions } from "../../../target-model/types/carriers/built-ins.js";
import { rustRetainedErrorTargetId } from "../../../target-model/types/carriers/source-error.js";
import { rustTypeFromSelectedNativeCarrier } from "./render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustGenericsWithAssociatedBounds(
  parameters: readonly RustGenericParameter[],
  predicates: readonly RustWherePredicate[],
): RustGenerics {
  const wherePredicates = [...predicates];
  const selectedParameters = parameters.map(parameter => {
    if (parameter.kind !== "type" || parameter.bounds.length === 0) return parameter;
    const index = wherePredicates.findIndex(predicate => predicate.kind === "type" &&
      (predicate.binder?.length ?? 0) === 0 && predicate.type.kind === "named" &&
      (predicate.type.genericArguments?.length ?? 0) === 0 && predicate.type.path === parameter.name);
    const selected = wherePredicates[index];
    if (selected?.kind !== "type") return parameter;
    const bounds = new Map([...parameter.bounds, ...selected.bounds].map(bound => [closedMetadataKey(bound), bound]));
    wherePredicates[index] = { ...selected, bounds: Object.freeze([...bounds.values()]) };
    return { ...parameter, bounds: Object.freeze([]) };
  });
  return Object.freeze({ parameters: Object.freeze(selectedParameters), wherePredicates: Object.freeze(wherePredicates) });
}

export function rustGenericRequirementBounds(requirements: readonly RustGenericRequirement[]): readonly RustTypeBound[] {
  return Object.freeze(requirements.map((requirement): RustTypeBound => {
    const bound = rustGenericRequirementBound(requirement, { identity: rustRetainedErrorTargetId,
      path: rustBuiltInCarrierDefinitions[rustRetainedErrorTargetId]?.renderPath });
    if (bound === undefined) return failRustPlannerInvariant("A selected native generic requirement lost its exact bound data.");
    return bound.kind === "trait-ref"
      ? { kind: "trait-type", reference: { trait: rustTypeFromSelectedNativeCarrier(bound) } }
      : { kind: "lifetime", lifetime: rustLifetimeToAst(bound) };
  }));
}

export function rustTypeParameterBounds(
  parameter: Extract<RustSourceGenericParameterContract, { readonly kind: "type" }>,
  requirements: readonly RustGenericRequirement[],
  requiredOutlives: readonly RustLifetimeRef[] = [],
): readonly RustTypeBound[] {
  const outlives = [...parameter.outlives,
    ...requiredOutlives.filter(required => !parameter.outlives.some(existing => rustLifetimesEqual(existing, required)))];
  return Object.freeze([
    ...outlives.map((lifetime): RustTypeBound => ({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime) })),
    ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
    ...rustGenericRequirementBounds(requirements.filter(requirement => requirement !== "static" ||
      !outlives.some(lifetime => lifetime.kind === "static"))),
  ]);
}
