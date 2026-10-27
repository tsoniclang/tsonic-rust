import type { RustGenericCallablePhysicalDefinition } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function rustGenericCallableEnvironmentGenerics(
  arguments_: readonly RustTargetGenericArgument[], context: RustPlanContext,
): RustGenerics {
  const parameters: RustGenericParameter[] = [];
  for (const argument of arguments_) {
    if (argument.kind === "lifetime" && argument.lifetime.kind === "parameter") {
      parameters.push({ kind: "lifetime", name: argument.lifetime.name, outlives: [] });
    } else if (argument.kind === "type" && argument.type.kind === "type-parameter") {
      parameters.push({ kind: "type", name: context.typeParameterNames?.get(argument.type.identity) ?? argument.type.name, bounds: [] });
    } else failRustPlannerInvariant("An admitted native callable environment requires its named generic parameters.");
  }
  return { parameters, wherePredicates: [] };
}

export function rustGenericCallableCapturePredicates(
  definition: RustGenericCallablePhysicalDefinition, context: RustPlanContext,
): readonly RustWherePredicate[] {
  const predicates = new Map<string, RustWherePredicate>();
  for (const member of definition.members) {
    const bindings = member.bindings;
    const capture = member.environment;
    if (bindings === undefined) failRustPlannerInvariant("An admitted native callable member requires its exact environment bindings.", member.implementation.declaration);
    const memberContext = { ...context, typeParameterSubstitutions: bindings.types, lifetimeSubstitutions: bindings.lifetimes };
    for (const input of capture.inputs) {
      const type = rustTypeFromCarrierInContext(input.implementation, memberContext);
      const trait = rustTypeFromCarrierInContext(input.trait, memberContext);
      if (type === undefined || trait === undefined) failRustPlannerInvariant("An admitted native callable capture requires its renderable type and trait bounds.", member.implementation.declaration);
      const predicate: RustWherePredicate = { kind: "type", type, bounds: [{ kind: "trait-type", reference: { trait } }] };
      predicates.set(closedMetadataKey(predicate), predicate);
    }
  }
  return Object.freeze([...predicates.values()]);
}
