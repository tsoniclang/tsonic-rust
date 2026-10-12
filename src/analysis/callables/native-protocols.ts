import { createHash } from "node:crypto";
import type { TargetTypeRef, RustTargetTraitRef, RustTargetGenericArgument } from "../../target-model/types/model.js";
import type { RustCallableSignatureBinding } from "../../target-model/types/carriers/callable-signatures.js";
import { rustCallableSignatureBinding } from "../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustNativeCallableCompletion, instantiateRustNativeCompletion, rustNativeCompletionFutureType,
  type RustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { bindRustCallableInputLifetimes } from "../../target-model/types/carriers/callable-input-lifetimes.js";
import type { RustLifetimeBinder } from "../../target-model/lifetimes/index.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";

export interface RustNativeCallableProtocol {
  readonly identity: string;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly boundProducerName?: string;
  readonly binding: RustCallableSignatureBinding;
  readonly method: {
    readonly parameters: readonly TargetTypeRef[];
    readonly result: TargetTypeRef;
    readonly binder: RustLifetimeBinder;
  };
  readonly completion?: RustNativeCallableCompletion;
  readonly trait: RustTargetTraitRef;
}

export function createRustNativeCallableProtocol(input: {
  readonly identity: string;
  readonly ownerFileName: string;
  readonly carrier: TargetTypeRef;
  readonly definitions: RustTypeDefinitions;
  readonly usedNames: Set<string>;
}): RustNativeCallableProtocol | undefined {
  const carrier = rustOptionElementCarrier(input.carrier) ?? input.carrier;
  const generic = rustGenericCallableValue(carrier);
  const ordinary = rustCallableProtocol(carrier);
  const binding = generic === undefined ? ordinary === undefined ? undefined :
    rustCallableSignatureBinding([], ordinary.parameters, ordinary.result) :
    { signature: generic.signature, environment: generic.environment };
  if (binding === undefined) return undefined;
  const method = bindRustCallableInputLifetimes(binding.signature.parameters, binding.signature.result);
  if (method === undefined) return undefined;
  const identity = `native-protocol:${input.identity}`;
  const targetName = allocateRustGeneratedName(input.usedNames,
    `NativeCallable_${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`);
  const completion = rustNativeCallableCompletion(method.result, input.definitions);
  return snapshotClosedMetadata({ identity, ownerFileName: input.ownerFileName, targetName, binding, method,
    ...(method.binder.parameters.length === 0 ? {} : {
      boundProducerName: allocateRustGeneratedName(input.usedNames, `${targetName}Bound`),
    }),
    ...(completion === undefined ? {} : { completion }),
    trait: { kind: "trait-ref", id: identity, path: targetName,
      sourceItem: { fileName: input.ownerFileName, typeName: targetName },
      genericArguments: rustTypeGenericArguments(binding.environment), associatedConstraints: [] },
  });
}

export function rustNativeCallableErrorType(
  protocol: RustNativeCallableProtocol,
  implementation: TargetTypeRef,
  channel: "invocation" | number,
  arguments_: readonly RustTargetGenericArgument[],
): TargetTypeRef | undefined {
  if (channel !== "invocation" && (!Number.isInteger(channel) || channel < 0 ||
    protocol.completion?.futures[channel]?.ordinal !== channel)) return undefined;
  const lifetimeCount = protocol.method.binder.parameters.length;
  if (arguments_.length !== lifetimeCount + protocol.binding.signature.typeParameters.length ||
    arguments_.some((argument, index) => argument.kind !== (index < lifetimeCount ? "lifetime" : "type"))) return undefined;
  return Object.freeze({ kind: "associated-type", owner: implementation, trait: protocol.trait,
    name: channel === "invocation" ? "InvocationError" : `AwaitError${channel}`, genericArguments: arguments_ });
}

export function rustNativeCallableMethodArguments(protocol: RustNativeCallableProtocol): readonly RustTargetGenericArgument[] {
  return Object.freeze([...protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime" as const,
    lifetime: parameter.lifetime })), ...rustTypeGenericArguments(protocol.binding.signature.typeParameters)]);
}

export function rustNativeCallableProtocolResult(
  protocol: RustNativeCallableProtocol,
): TargetTypeRef | undefined {
  const self: TargetTypeRef = { kind: "type-parameter", identity: `${protocol.identity}:Self`, name: "Self" };
  const arguments_ = rustNativeCallableMethodArguments(protocol);
  const captures = [...arguments_.filter(argument => argument.kind === "lifetime"),
    ...rustTypeGenericArguments([self, ...protocol.binding.signature.environmentParameters,
      ...protocol.binding.signature.typeParameters])];
  const error = (name: string): TargetTypeRef => ({ kind: "associated-type", owner: self, name, genericArguments: arguments_ });
  const completion = protocol.completion === undefined ? protocol.method.result :
    instantiateRustNativeCompletion(protocol.completion, future => {
      const selectedError = error(`AwaitError${future.ordinal}`);
      if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
        const arguments_ = future.carrier.genericArguments;
        return arguments_?.length !== 3 ? undefined : { ...future.carrier,
          genericArguments: [arguments_[0]!, arguments_[1]!, { kind: "type", type: selectedError }] };
      }
      return rustNativeCompletionFutureType({ identity: `${protocol.identity}:future:${future.ordinal}`,
        output: future.output, error: selectedError, captures });
    });
  return completion === undefined ? undefined : rustNamedTargetType(`${protocol.identity}:result`, "Result",
    rustTypeGenericArguments([completion, error("InvocationError")]));
}
