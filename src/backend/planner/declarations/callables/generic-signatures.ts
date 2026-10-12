import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../../analysis/callables/generic-physical.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustTargetGenericBindings } from "../../../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import { rustTargetGenericBindingsForArguments } from "../../../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../../../target-model/types/carriers/substitution.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function rustGenericCallableImplementationSubstitutions(
  definition: RustGenericCallableDefinition,
  implementation: RustGenericCallableImplementation,
  context: RustPlanContext,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const source = context.input.program.sourceLifetimes.contractFor(implementation.declaration);
  const parameters = source?.parameters ??
    (context.input.program.source.ast.typeParameters(implementation.declaration).length === 0 ? [] : undefined);
  if (parameters === undefined || parameters.length !== definition.signature.typeParameters.length ||
    parameters.some(parameter => parameter.kind !== "type")) return undefined;
  const substitutions = new Map(implementation.substitutions);
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.kind !== "type") return undefined;
    substitutions.set(parameter.identity, definition.signature.typeParameters[index]!);
  }
  return substitutions;
}

export function rustGenericCallableMemberBindings(
  definition: RustGenericCallableDefinition, member: RustGenericCallablePhysicalMember, context: RustPlanContext,
): RustTargetGenericBindings | undefined {
  const source = rustGenericCallableImplementationSubstitutions(definition, member.implementation, context);
  const environment = context.input.program.callableValues.generic.physical.environmentFor(member.implementation);
  if (source === undefined || environment === undefined) return undefined;
  const parameters = environment.parameters.map(argument => argument.kind === "type" && argument.type.kind === "type-parameter"
    ? { kind: "type" as const, sourceName: argument.type.name, targetIdentity: argument.type.identity }
    : argument.kind === "lifetime" && argument.lifetime.kind === "parameter"
      ? { kind: "lifetime" as const, sourceName: argument.lifetime.name, targetIdentity: rustLifetimeKey(argument.lifetime) }
      : argument.kind === "const" && argument.value.kind === "parameter"
        ? { kind: "const" as const, sourceName: argument.value.name, targetIdentity: argument.value.identity } : undefined);
  if (parameters.some(parameter => parameter === undefined)) return undefined;
  const selected = rustTargetGenericBindingsForArguments(parameters as NonNullable<typeof parameters[number]>[], member.arguments);
  if (selected === undefined) return undefined;
  const types = new Map(source);
  for (const [identity, type] of environment.substitutions.types)
    types.set(identity, substituteRustTargetGenerics(type, selected.types, selected.lifetimes, selected.consts));
  const lifetimes = new Map([...environment.substitutions.lifetimes].map(([identity, lifetime]) =>
    [identity, selected.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime]));
  const consts = new Map([...environment.substitutions.consts].map(([identity, value]) =>
    [identity, value.kind === "parameter" ? selected.consts.get(value.identity) ?? value : value]));
  return { types, lifetimes, consts };
}

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
    const bindings = rustGenericCallableMemberBindings(definition, member, context);
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
