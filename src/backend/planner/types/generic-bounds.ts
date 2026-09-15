import type { RustGenericRequirement } from "../../../analysis/declarations/generic-requirements.js";
import type { RustLifetimeRef, RustSourceGenericParameterContract } from "../../../target-model/lifetimes/index.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import type { RustGenericParameter, RustGenerics, RustTypeBound, RustWherePredicate } from "../../target-ast/nodes.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

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
  return Object.freeze(requirements.map((requirement): RustTypeBound => requirement === "static"
    ? { kind: "lifetime", lifetime: { kind: "static" } }
    : { kind: "trait", path: requirement === "clone" ? "Clone" : requirement === "default" ? "Default" : "js_abi::SourceNumeric" }));
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
