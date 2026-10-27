import { type TargetTypeRef, type RustTargetGenericArgument } from "../../../target-model/types/model.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../../target-model/types/callable-completions.js";
import { rustNativeCallableCompletion } from "./native-completion.js";
import { type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustLifetimeKey, rustStaticLifetime, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { type RustNativeCallableProtocol, type RustNativeCallableProtocolBinding, type RustNativeCallableOutlivesBound,
  rustNativeCallableProtocolIdPrefix } from "../../../target-model/records/native/native-protocols.js";
import { rustNamedTypeCarrierValue } from "../../../target-model/types/carriers/native.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustJsPromiseTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";
import { rustJsValueTargetType } from "../../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustCallableSignatureBinding } from "../../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { bindRustCallableInputLifetimes } from "../../../target-model/types/carriers/callable-input-lifetimes.js";
import { rustGenericCallablePhysicalBindings } from "./generic-bindings.js";
import { closeRustRetainedCallableCarrier } from "../../ownership/retained-storage.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";

export function selectRustNativeCallableOutlivesBounds(method: Pick<RustNativeCallableProtocol["method"], "parameters" | "binder">): readonly RustNativeCallableOutlivesBound[] {
  const lifetimes = new Set(method.binder.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)));
  const bounds = new Map<string, RustNativeCallableOutlivesBound>();
  const visited = new Set<TargetTypeRef>();
  const visit = (carrier: TargetTypeRef): void => {
    if (visited.has(carrier)) return;
    visited.add(carrier);
    if (carrier.kind === "reference" && carrier.lifetime !== undefined && lifetimes.has(rustLifetimeKey(carrier.lifetime))) {
      const references = rustTargetGenericReferences(carrier.referent);
      if (references.typeIdentities.length > 0 || references.lifetimes.length > 0)
        bounds.set(closedMetadataKey([carrier.referent, carrier.lifetime]), Object.freeze({ carrier: carrier.referent, lifetime: carrier.lifetime }));
    }
    for (const child of rustTargetTypeChildren(carrier)) visit(child);
  };
  for (const carrier of method.parameters) visit(carrier);
  return Object.freeze([...bounds.values()]);
}

export function rustNativeCallableErrorType(
  binding: Pick<RustNativeCallableProtocolBinding, "protocol" | "trait">,
  implementation: TargetTypeRef,
  channel: "invocation" | number,
  arguments_: readonly RustTargetGenericArgument[],
): TargetTypeRef | undefined {
  const protocol = binding.protocol;
  if (binding.trait.id !== protocol.identity ||
    rustGenericCallablePhysicalBindings(protocol.environmentParameters, binding.trait.genericArguments) === undefined) return undefined;
  if (channel !== "invocation" && (!Number.isInteger(channel) || channel < 0 ||
    protocol.completion?.futures[channel]?.ordinal !== channel)) return undefined;
  const lifetimeCount = protocol.method.binder.parameters.length;
  if (arguments_.length !== lifetimeCount + protocol.signature.typeParameters.length ||
    arguments_.some((argument, index) => argument.kind !== (index < lifetimeCount ? "lifetime" : "type"))) return undefined;
  const future = channel === "invocation" ? undefined : protocol.completion?.futures[channel];
  if (future?.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId)
    return rustJsValueTargetType();
  return Object.freeze({ kind: "associated-type", owner: implementation, trait: binding.trait,
    name: channel === "invocation" ? "InvocationError" : `AwaitError${channel}`, genericArguments: arguments_ });
}

type RustNativeCallableProtocolResultInput = Pick<RustNativeCallableProtocol, "identity" | "signature" | "method" | "completion" | "environmentParameters">;

function nativeCallableMethodArguments(protocol: RustNativeCallableProtocolResultInput): readonly RustTargetGenericArgument[] {
  return Object.freeze([...protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime" as const,
    lifetime: parameter.lifetime })), ...rustTypeGenericArguments(protocol.signature.typeParameters)]);
}

/**
 * The invocation error of a type-erased runtime callable seen through a native callable protocol:
 * `<rt::Callable<'a, Arguments, Result<Output, Error>> as NativeCallable_x<..>>::InvocationError` is `Error`, because
 * every protocol's producer bridge implements it for each `rt::CallableImplementation` with that output.
 */
export function rustErasedCallableInvocationError(carrier: TargetTypeRef): TargetTypeRef | undefined {
  if (carrier.kind !== "associated-type" || carrier.name !== "InvocationError" ||
    carrier.trait?.id.startsWith(rustNativeCallableProtocolIdPrefix) !== true) return undefined;
  const owner = carrier.owner.kind === "target-named" ? carrier.owner : rustNamedTypeCarrierValue(carrier.owner);
  if (owner?.id !== rustCallableTargetId || owner.genericArguments?.length !== 3) return undefined;
  const output = owner.genericArguments[2];
  const result = output?.kind !== "type" ? undefined
    : output.type.kind === "target-named" ? output.type : rustNamedTypeCarrierValue(output.type);
  const error = result?.id === "rust.core.Result" && result.genericArguments?.length === 2 ? result.genericArguments[1] : undefined;
  return error?.kind === "type" ? error.type : undefined;
}

export function rustNativeCallableErrorChannel(
  binding: Pick<RustNativeCallableProtocolBinding, "protocol" | "trait">,
  implementation: TargetTypeRef,
  carrier: TargetTypeRef,
): "invocation" | number | undefined {
  if (carrier.kind !== "associated-type" || !rustTargetTypeRefEquals(carrier.owner, implementation)) return undefined;
  const channels = ["invocation" as const, ...(binding.protocol.completion?.futures.map(future => future.ordinal) ?? [])];
  return channels.find(channel => {
    const expected = rustNativeCallableErrorType(binding, implementation, channel, carrier.genericArguments ?? []);
    return expected !== undefined && rustTargetTypeRefEquals(expected, carrier);
  });
}

export function selectRustNativeCallableProtocolResult(
  protocol: RustNativeCallableProtocolResultInput,
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const self: TargetTypeRef = { kind: "type-parameter", identity: `${protocol.identity}:Self`, name: "Self" };
  const arguments_ = nativeCallableMethodArguments(protocol);
  const captures = [...arguments_.filter(argument => argument.kind === "lifetime"),
    ...protocol.environmentParameters.filter(argument => argument.kind === "lifetime"),
    ...rustTypeGenericArguments([self]), ...protocol.environmentParameters.filter(argument => argument.kind !== "lifetime"),
    ...rustTypeGenericArguments(protocol.signature.typeParameters)];
  const error = (name: string): TargetTypeRef => ({ kind: "associated-type", owner: self, name, genericArguments: arguments_ });
  const completion = protocol.completion === undefined ? protocol.method.result :
    instantiateRustNativeCompletion(protocol.completion, future =>
      future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId
        ? rustJsPromiseOutputTargetType(future.carrier) === undefined ? undefined : future.carrier
        : rustNativeCompletionFutureType({ identity: `${protocol.identity}:future:${future.ordinal}`,
          output: future.output, error: error(`AwaitError${future.ordinal}`), captures }), definitions);
  return completion === undefined ? undefined : rustNamedTargetType("rust.core.Result", "Result",
    rustTypeGenericArguments([completion, error("InvocationError")]));
}

export function selectRustNativeCallableProtocolSignature(source: TargetTypeRef, definitions: RustTypeDefinitions) {
      const carrier = rustOptionElementCarrier(source) ?? source;
      const generic = rustGenericCallableValue(carrier);
      const ordinary = rustCallableProtocol(carrier);
      const binding = generic === undefined ? ordinary === undefined ? undefined :
        rustCallableSignatureBinding([], ordinary.parameters, ordinary.result) :
        { signature: generic.signature, environment: generic.environment };
      if (binding === undefined) return undefined;
      const outputLifetime = ordinary?.lifetime;
      const owningLifetime = outputLifetime === undefined || outputLifetime.kind === "placeholder" ? rustStaticLifetime : outputLifetime;
      const ownedResult = closeRustRetainedCallableCarrier(binding.signature.result, owningLifetime);
      const selectedMethod = bindRustCallableInputLifetimes(binding.signature.parameters, binding.signature.result,
        { kind: "owned-output", carrier: ownedResult });
      if (selectedMethod === undefined) return undefined;
      const invocationLifetimes = new Set(selectedMethod.binder.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)));
      const references = rustTargetGenericReferences({ kind: "tuple", elements: [...selectedMethod.parameters, selectedMethod.result] });
      const environmentLifetimes = [...new Map([...references.lifetimes, ...references.callScopedElisions]
        .filter(lifetime => !invocationLifetimes.has(rustLifetimeKey(lifetime)))
        .map(lifetime => [rustLifetimeKey(lifetime), lifetime])).values()];
      const lifetimeParameters = environmentLifetimes.map((_lifetime, index) => Object.freeze({ kind: "parameter" as const,
        identity: `rust.native-protocol:environment:${index}`, name: `environment_${index}` }));
      const lifetimeBindings: ReadonlyMap<string, RustLifetimeRef> = new Map(environmentLifetimes.map((lifetime, index) =>
        [rustLifetimeKey(lifetime), lifetimeParameters[index]!]));
      const bindEnvironment = (carrier: TargetTypeRef): TargetTypeRef => lifetimeBindings.size === 0 ? carrier
        : substituteRustTargetGenerics(carrier, new Map(), lifetimeBindings, new Map(), (current, original) => {
          if (original.kind === "type-parameter" && original.optionalStorageValue !== undefined) {
            const payload = bindEnvironment(original.optionalStorageValue);
            return rustTargetTypeRefEquals(payload, original.optionalStorageValue) ? original
              : Object.freeze({ ...original, optionalStorageValue: payload });
          }
          return rustTargetTypeRefEquals(current, original) ? original : current;
        }, parent => parent.kind !== "type-parameter");
      const nativeMethod = { binder: selectedMethod.binder,
        parameters: Object.freeze(selectedMethod.parameters.map(bindEnvironment)),
        result: bindEnvironment(selectedMethod.result),
        sourceResult: bindEnvironment(selectedMethod.ownedOutput ? binding.signature.result : selectedMethod.result) };
      const method = Object.freeze({ ...nativeMethod, outlives: selectRustNativeCallableOutlivesBounds(nativeMethod) });
      const completion = rustNativeCallableCompletion(method.result, definitions);

  return Object.freeze({ signature: binding.signature,
    environmentParameters: Object.freeze([
      ...lifetimeParameters.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
      ...rustTypeGenericArguments(binding.signature.environmentParameters)]),
    environment: Object.freeze([
      ...environmentLifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
      ...rustTypeGenericArguments(binding.environment)]), method,
    identityMethod: nativeMethod, ...(completion === undefined ? {} : { completion }) });
}
