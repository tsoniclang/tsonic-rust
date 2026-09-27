import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../../../target-model/types/index.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustGenerics, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { projectTypeSubstitutions, projectLifetimeSubstitutions } from "./model.js";
import type { RustProjectGenericPlan } from "./names.js";
import { rustAuthoredTypeParameterNames } from "../../../../target-model/names/type-parameters.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";
import { substituteRustTargetGenerics } from "../../../../target-model/types/carriers/substitution.js";

export function rustProjectImplementationContext(
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): RustPlanContext {
  const parameters = rustTargetGenericReferences(carrier).typeParameters;
  context = rustGeneratedTypeParameterContext(parameters,
    rustAuthoredTypeParameterNames(definition.declaration, context.input.program.source.ast,
      new Set(definition.typeParameterIdentities)), context);
  return { ...context, typeParameterSubstitutions: projectTypeSubstitutions(definition, carrier),
    lifetimeSubstitutions: projectLifetimeSubstitutions(definition, carrier) };
}

export function rustProjectImplementationGenerics(
  carrier: TargetTypeRef, selected: RustProjectGenericPlan, context: RustPlanContext,
): RustGenerics | undefined {
  const references = rustTargetGenericReferences(carrier);
  if (references.constIdentities.length !== 0 || references.lifetimes.some(lifetime => lifetime.kind !== "parameter")) return undefined;
  const predicates: RustWherePredicate[] = [...selected.wherePredicates];
  const typeParameters = new Map(references.typeParameters.map(parameter => [parameter.identity, parameter]));
  for (const { parameter, argument } of selected.bindings) {
    if (parameter.kind === "type" && argument.kind === "type") {
      const selectedType = substituteRustTargetGenerics(argument.type, context.typeParameterSubstitutions ?? new Map(),
        context.lifetimeSubstitutions ?? new Map());
      if (selectedType.kind === "type-parameter" && selectedType.optionalStorageValue !== undefined)
        typeParameters.set(selectedType.identity, selectedType);
      const type = rustTypeFromCarrierInContext(argument.type, context);
      if (type === undefined) return undefined;
      if (parameter.bounds.length !== 0) predicates.push({ kind: "type", type, bounds: parameter.bounds });
    } else if (parameter.kind === "lifetime" && argument.kind === "lifetime") {
      const lifetime = context.lifetimeSubstitutions?.get(rustLifetimeKey(argument.lifetime));
      if (lifetime === undefined) return undefined;
      if (parameter.outlives.length !== 0) predicates.push({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime), outlives: parameter.outlives });
    } else return undefined;
  }
  return { parameters: [
    ...references.lifetimes.filter(lifetime => lifetime.kind === "parameter").map(lifetime => ({ kind: "lifetime" as const, name: lifetime.name, outlives: [] })),
    ...[...typeParameters.values()].map(parameter => ({ kind: "type" as const,
      name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name, bounds: [] })),
  ], wherePredicates: predicates };
}
