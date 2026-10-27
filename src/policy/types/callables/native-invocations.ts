import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustNativeCallableProtocolBinding } from "../../../target-model/records/native-protocols.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustCallScopedLifetimeReconciliation } from "../../conversions/value-carrier-reconciliation.js";
import { rustGenericCallablePhysicalBindings } from "./generic-bindings.js";

export function rustNativeCallableInvocationArguments(
  binding: RustNativeCallableProtocolBinding,
  operation: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  callIdentity: string,
): readonly RustTargetGenericArgument[] | undefined {
  if (typeof callIdentity !== "string" || callIdentity.length === 0) return undefined;
  const arguments_ = operation.targetGenericArguments ?? [];
  const protocol = binding.protocol;
  const signature = protocol.signature;
  if (arguments_.length !== signature.typeParameters.length || arguments_.some(argument => argument.kind !== "type") ||
    operation.parameters.length !== protocol.method.parameters.length) return undefined;
  const environment = rustGenericCallablePhysicalBindings(protocol.environmentParameters, binding.environment);
  if (environment === undefined) return undefined;
  const substitutions = new Map(environment.types);
  for (const [index, parameter] of signature.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    substitutions.set(parameter.identity, argument.type);
  }
  const pattern: TargetTypeRef = { kind: "tuple", elements: [...protocol.method.parameters, protocol.method.sourceResult]
    .map(carrier => substituteRustTargetGenerics(carrier, substitutions, environment.lifetimes, environment.consts)) };
  const actual: TargetTypeRef = { kind: "tuple", elements: [...operation.parameters.map(parameter => parameter.parameterCarrier),
    operation.resultCarrier] };
  const elisions = new Map(protocol.method.binder.parameters.map(parameter => {
    const identity = rustLifetimeKey(parameter.lifetime);
    return [identity, rustCallScopedElisionLifetime(callIdentity, identity)] as const;
  }));
  const bindings = inferRustTargetGenericBindings(pattern, actual, {
    typeIdentities: new Set(), constIdentities: new Set(),
    lifetimeIdentities: new Set(elisions.keys()),
  }, { callScopedElisionBindings: elisions });
  if (bindings === undefined) return undefined;
  const selected = substituteRustTargetGenerics(pattern, bindings.types, bindings.lifetimes);
  if (!rustTargetTypeRefEquals(selected, actual) &&
    selectRustCallScopedLifetimeReconciliation(selected, actual) === undefined) return undefined;
  const lifetimes: RustTargetGenericArgument[] = [];
  for (const parameter of protocol.method.binder.parameters) {
    const lifetime = bindings.lifetimes.get(rustLifetimeKey(parameter.lifetime));
    if (lifetime === undefined) return undefined;
    lifetimes.push({ kind: "lifetime", lifetime });
  }
  return Object.freeze([...lifetimes, ...arguments_]);
}
