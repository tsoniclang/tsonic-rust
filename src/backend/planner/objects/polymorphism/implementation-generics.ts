import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../../../target-model/types/index.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustGenerics, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { projectTypeSubstitutions, projectLifetimeSubstitutions } from "./model.js";

export function rustProjectImplementationContext(
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): RustPlanContext {
  return { ...context, typeParameterSubstitutions: projectTypeSubstitutions(definition, carrier),
    lifetimeSubstitutions: projectLifetimeSubstitutions(definition, carrier) };
}

export function rustProjectImplementationGenerics(
  carrier: TargetTypeRef, definition: RustProjectTypeDefinition, selected: RustGenerics, context: RustPlanContext,
): RustGenerics | undefined {
  const references = rustTargetGenericReferences(carrier);
  if (references.constIdentities.length !== 0 || references.lifetimes.some(lifetime => lifetime.kind !== "parameter")) return undefined;
  const predicates: RustWherePredicate[] = [...selected.wherePredicates];
  for (const parameter of selected.parameters) {
    if (parameter.kind === "type") {
      const argument = context.typeParameterSubstitutions?.get(parameter.name);
      const type = argument === undefined ? undefined : rustTypeFromCarrierInContext(argument, context);
      if (type === undefined) return undefined;
      if (parameter.bounds.length !== 0) predicates.push({ kind: "type", type, bounds: parameter.bounds });
    } else if (parameter.kind === "lifetime") {
      const declared = definition.genericParameters.find(candidate => candidate.kind === "lifetime" && candidate.lifetime.name === parameter.name);
      if (declared?.kind !== "lifetime") return undefined;
      const lifetime = context.lifetimeSubstitutions?.get(rustLifetimeKey(declared.lifetime));
      if (lifetime === undefined) return undefined;
      if (parameter.outlives.length !== 0) predicates.push({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime), outlives: parameter.outlives });
    } else return undefined;
  }
  return { parameters: [
    ...references.lifetimes.filter(lifetime => lifetime.kind === "parameter").map(lifetime => ({ kind: "lifetime" as const, name: lifetime.name, outlives: [] })),
    ...references.typeNames.map(name => ({ kind: "type" as const, name, bounds: [] })),
  ], wherePredicates: predicates };
}
