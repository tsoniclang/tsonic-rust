import type { RustTargetOperationFact } from "../facts/keys.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeCallableProtocol } from "./native-protocols.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function rustNativeCallableInvocationArguments(
  protocol: RustNativeCallableProtocol,
  operation: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
): readonly RustTargetGenericArgument[] | undefined {
  const arguments_ = operation.targetGenericArguments ?? [];
  const signature = protocol.binding.signature;
  if (arguments_.length !== signature.typeParameters.length || arguments_.some(argument => argument.kind !== "type") ||
    operation.parameters.length !== protocol.method.parameters.length) return undefined;
  const substitutions = new Map<string, TargetTypeRef>(signature.environmentParameters.map((parameter, index) =>
    [parameter.identity, protocol.binding.environment[index]!]));
  for (const [index, parameter] of signature.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    substitutions.set(parameter.identity, argument.type);
  }
  const pattern: TargetTypeRef = { kind: "tuple", elements: [...protocol.method.parameters, protocol.method.result]
    .map(carrier => substituteRustTargetGenerics(carrier, substitutions)) };
  const actual: TargetTypeRef = { kind: "tuple", elements: [...operation.parameters.map(parameter => parameter.valueCarrier),
    operation.resultCarrier] };
  const bindings = inferRustTargetGenericBindings(pattern, actual, {
    typeIdentities: new Set(), constIdentities: new Set(),
    lifetimeIdentities: new Set(protocol.method.binder.parameters.map(parameter => rustLifetimeKey(parameter.lifetime))),
  });
  if (bindings === undefined || !rustTargetTypeRefEquals(substituteRustTargetGenerics(pattern, bindings.types, bindings.lifetimes), actual)) return undefined;
  const lifetimes: RustTargetGenericArgument[] = [];
  for (const parameter of protocol.method.binder.parameters) {
    const lifetime = bindings.lifetimes.get(rustLifetimeKey(parameter.lifetime));
    if (lifetime === undefined) return undefined;
    lifetimes.push({ kind: "lifetime", lifetime });
  }
  return Object.freeze([...lifetimes, ...arguments_]);
}
