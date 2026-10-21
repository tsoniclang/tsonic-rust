import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustGenerics, RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustProjectGenericPlan } from "./names.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function rustProjectImplementationContext(
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): RustPlanContext {
  const selected = context.input.program.records.classImplementationContext.get(definition.declaration, carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted class implementation requires its sealed native generic and naming context.", definition.declaration);
  return { ...context, typeParameterNames: new Map([...context.typeParameterNames ?? [], ...selected.names]),
    typeParameterSubstitutions: selected.types, lifetimeSubstitutions: selected.lifetimes };
}

export function rustProjectImplementationGenerics(
  carrier: TargetTypeRef, selected: RustProjectGenericPlan, context: RustPlanContext,
): RustGenerics | undefined {
  const references = context.input.program.records.classImplementationGenerics.get(carrier);
  if (references === undefined) failRustPlannerInvariant("An admitted class implementation requires its sealed native generic inventory.");
  const predicates: RustWherePredicate[] = [...selected.wherePredicates];
  for (const { parameter, argument } of selected.bindings) {
    if (parameter.kind === "type" && argument.kind === "type") {
      const type = rustTypeFromCarrierInContext(argument.type, context);
      if (type === undefined) failRustPlannerInvariant("An admitted native implementation bound requires its rendered carrier.");
      if (parameter.bounds.length !== 0) predicates.push({ kind: "type", type, bounds: parameter.bounds });
    } else if (parameter.kind === "lifetime" && argument.kind === "lifetime") {
      const lifetime = context.lifetimeSubstitutions?.get(rustLifetimeKey(argument.lifetime));
      if (lifetime === undefined) failRustPlannerInvariant("An admitted native implementation bound requires its rendered lifetime.");
      if (parameter.outlives.length !== 0) predicates.push({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime), outlives: parameter.outlives });
    } else failRustPlannerInvariant("An admitted native implementation requires matching generic parameter and argument kinds.");
  }
  return { parameters: [
    ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, name: lifetime.name, outlives: [] })),
    ...references.parameters.map(parameter => ({ kind: "type" as const,
      name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name, bounds: [] })),
  ], wherePredicates: predicates };
}
