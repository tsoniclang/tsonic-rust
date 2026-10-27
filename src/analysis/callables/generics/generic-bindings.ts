import type { AstReader } from "@tsonic/tsts";
import { rustLifetimeKey, type RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import type { RustGenericCallableDefinition } from "../../../target-model/records/generic-callables.js";
import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/generic-callables.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../target-model/records/generic-callables.js";

export interface RustGenericCallableBindingContext {
  readonly ast: AstReader;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly physical: RustGenericCallablePhysicalPlan;
}

export function rustGenericCallableMemberBindings(
  definition: RustGenericCallableDefinition,
  member: Pick<RustGenericCallablePhysicalMember, "implementation" | "arguments">,
  input: Pick<RustGenericCallableBindingContext, "ast" | "sourceLifetimes"> & {
    readonly physical: Pick<RustGenericCallablePhysicalPlan, "environmentFor">;
  },
): RustTargetGenericBindings | undefined {
  const implementation = member.implementation;
  const contract = input.sourceLifetimes.contractFor(implementation.declaration);
  const parameters = contract?.parameters ?? (input.ast.typeParameters(implementation.declaration).length === 0 ? [] : undefined);
  const environment = input.physical.environmentFor(implementation);
  if (parameters === undefined || environment === undefined || parameters.length !== definition.signature.typeParameters.length ||
    parameters.some(parameter => parameter.kind !== "type")) return undefined;
  const selected = rustGenericCallablePhysicalBindings(environment.parameters, member.arguments);
  if (selected === undefined) return undefined;
  const types = new Map(implementation.substitutions);
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.kind !== "type") return undefined;
    types.set(parameter.identity, definition.signature.typeParameters[index]!);
  }
  for (const [identity, type] of environment.substitutions.types)
    types.set(identity, substituteRustTargetGenerics(type, selected.types, selected.lifetimes, selected.consts));
  const lifetimes = new Map([...environment.substitutions.lifetimes].map(([identity, lifetime]) =>
    [identity, selected.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime]));
  const consts = new Map([...environment.substitutions.consts].map(([identity, value]) =>
    [identity, value.kind === "parameter" ? selected.consts.get(value.identity) ?? value : value]));
  return snapshotRustCallableBindings({ types, lifetimes, consts });
}

export function rustGenericCallableInvocationBindings(
  definition: RustGenericCallablePhysicalDefinition, carrier: TargetTypeRef,
  methodArguments: readonly RustTargetGenericArgument[], physical: RustGenericCallablePhysicalPlan,
): RustTargetGenericBindings | undefined {
  const value = rustGenericCallableValue(carrier);
  const arguments_ = physical.argumentsFor(carrier);
  if (value === undefined || arguments_ === undefined || physical.definitionFor(carrier) !== definition) return undefined;
  return rustGenericCallablePhysicalBindings([...rustTypeGenericArguments(definition.signature.environmentParameters), ...definition.parameters,
    ...rustTypeGenericArguments(definition.signature.typeParameters)],
  [...rustTypeGenericArguments(value.environment), ...arguments_, ...methodArguments]);
}

export function rustGenericCallableMemberInvocationBindings(
  definition: RustGenericCallablePhysicalDefinition,
  member: RustGenericCallablePhysicalMember,
  carrier: TargetTypeRef,
  methodArguments: readonly RustTargetGenericArgument[],
  input: RustGenericCallableBindingContext,
): RustTargetGenericBindings | undefined {
  if (!definition.members.includes(member)) return undefined;
  const invocation = rustGenericCallableInvocationBindings(definition, carrier, methodArguments, input.physical);
  const source = member.bindings;
  if (invocation === undefined || source === undefined) return undefined;
  return Object.freeze({
    types: new Map([...source.types].map(([identity, type]) => [identity,
      substituteRustTargetGenerics(type, invocation.types, invocation.lifetimes, invocation.consts)])),
    lifetimes: new Map([...source.lifetimes].map(([identity, lifetime]) =>
      [identity, invocation.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime])),
    consts: new Map([...source.consts].map(([identity, value]) =>
      [identity, value.kind === "parameter" ? invocation.consts.get(value.identity) ?? value : value])),
  });
}

import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "../../../policy/types/callables/generic-bindings.js";
