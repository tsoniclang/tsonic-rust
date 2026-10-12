import type { RustGenericCallablePhysicalDefinition } from "../../../../analysis/callables/generic-physical.js";
import type { RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate } from "../../../target-ast/nodes.js";
import { rustGenericCallableMemberBindings } from "../../../../analysis/callables/generic-bindings.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function rustGenericCallableEnvironmentGenerics(
  arguments_: readonly RustTargetGenericArgument[], context: RustPlanContext,
): RustGenerics | undefined {
  const parameters: RustGenericParameter[] = [];
  for (const argument of arguments_) {
    if (argument.kind === "lifetime" && argument.lifetime.kind === "parameter") {
      const lifetime = rustLifetimeToAst(argument.lifetime);
      if (lifetime.kind !== "named") return undefined;
      parameters.push({ kind: "lifetime", name: lifetime.name, outlives: [] });
    } else if (argument.kind === "type" && argument.type.kind === "type-parameter") {
      const type = rustTypeFromCarrierInContext(argument.type, context);
      if (type?.kind !== "named" || type.genericArguments?.length) return undefined;
      parameters.push({ kind: "type", name: type.path, bounds: [] });
    } else return undefined;
  }
  return { parameters, wherePredicates: [] };
}

export function rustGenericCallableCapturePredicates(
  definition: RustGenericCallablePhysicalDefinition, context: RustPlanContext,
): readonly RustWherePredicate[] | undefined {
  const predicates = new Map<string, RustWherePredicate>();
  for (const member of definition.members) {
    const bindings = rustGenericCallableMemberBindings(definition, member, {
      ast: context.input.program.source.ast, sourceLifetimes: context.input.program.sourceLifetimes,
      physical: context.input.program.callableValues.generic.physical,
    });
    const capture = context.input.program.callableValues.generic.physical.environmentFor(member.implementation);
    if (bindings === undefined || capture === undefined) return undefined;
    const memberContext = { ...context, typeParameterSubstitutions: bindings.types, lifetimeSubstitutions: bindings.lifetimes };
    for (const input of capture.inputs) {
      const type = rustTypeFromCarrierInContext(input.implementation, memberContext);
      const trait = rustTypeFromCarrierInContext(input.trait, memberContext);
      if (type === undefined || trait === undefined) return undefined;
      const predicate: RustWherePredicate = { kind: "type", type, bounds: [{ kind: "trait-type", reference: { trait } }] };
      predicates.set(closedMetadataKey(predicate), predicate);
    }
  }
  return Object.freeze([...predicates.values()]);
}
