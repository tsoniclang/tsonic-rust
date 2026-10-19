import { createHash } from "node:crypto";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../target-model/types/model.js";
import { rustCallableSignatureBinding } from "../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustNativeCallableCompletion, instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { bindRustCallableInputLifetimes } from "../../target-model/types/carriers/callable-input-lifetimes.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { RustNativeCallableProtocol, RustNativeCallableProtocolBinding, RustNativeCallableOutlivesBound } from "../../target-model/records/native-protocols.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export interface RustNativeCallableProtocolRegistry {
  bind(ownerFileName: string, carrier: TargetTypeRef): RustNativeCallableProtocolBinding | undefined;
  definitions(): readonly RustNativeCallableProtocol[];
}

export function createRustNativeCallableProtocolRegistry(input: {
  readonly definitions: RustTypeDefinitions;
  readonly usedNames: Set<string>;
}): RustNativeCallableProtocolRegistry {
  const protocols = new Map<string, RustNativeCallableProtocol>();
  return Object.freeze({
    bind(ownerFileName: string, source: TargetTypeRef): RustNativeCallableProtocolBinding | undefined {
      if (ownerFileName.length === 0) return undefined;
      const carrier = rustOptionElementCarrier(source) ?? source;
      const generic = rustGenericCallableValue(carrier);
      const ordinary = rustCallableProtocol(carrier);
      const binding = generic === undefined ? ordinary === undefined ? undefined :
        rustCallableSignatureBinding([], ordinary.parameters, ordinary.result) :
        { signature: generic.signature, environment: generic.environment };
      if (binding === undefined) return undefined;
      const selectedMethod = bindRustCallableInputLifetimes(binding.signature.parameters, binding.signature.result);
      if (selectedMethod === undefined) return undefined;
      const method = Object.freeze({ ...selectedMethod, outlives: nativeCallableOutlivesBounds(selectedMethod) });
      const completion = rustNativeCallableCompletion(method.result, input.definitions);
      const contract = { ownerFileName, signature: binding.signature, method,
        ...(completion === undefined ? {} : { completion }) };
      const key = closedMetadataKey(contract);
      let protocol = protocols.get(key);
      if (protocol === undefined) {
        const identity = `native-protocol:${createHash("sha256").update(key).digest("hex")}`;
        const result = nativeCallableProtocolResult({ ...contract, identity }, input.definitions);
        if (result === undefined) return undefined;
        const targetName = allocateRustGeneratedName(input.usedNames, `NativeCallable_${identity.slice(-16)}`);
        protocol = snapshotClosedMetadata({ ...contract, identity, targetName, result,
          ...(method.binder.parameters.length === 0 ? {} : {
            boundProducerName: allocateRustGeneratedName(input.usedNames, `${targetName}Bound`),
          }),
          trait: { kind: "trait-ref", id: identity, path: targetName,
            sourceItem: { fileName: ownerFileName, typeName: targetName },
            genericArguments: rustTypeGenericArguments(binding.signature.environmentParameters), associatedConstraints: [] },
        });
        protocols.set(key, protocol);
      }
      return Object.freeze({ protocol, environment: snapshotClosedMetadata(binding.environment),
        trait: snapshotClosedMetadata({ ...protocol.trait, genericArguments: rustTypeGenericArguments(binding.environment) }) });
    },
    definitions: () => Object.freeze([...protocols.values()]),
  });
}

function nativeCallableOutlivesBounds(method: Pick<RustNativeCallableProtocol["method"], "parameters" | "binder">): readonly RustNativeCallableOutlivesBound[] {
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
    binding.trait.genericArguments.length !== protocol.signature.environmentParameters.length) return undefined;
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

type RustNativeCallableProtocolResultInput = Pick<RustNativeCallableProtocol, "identity" | "signature" | "method" | "completion">;

function nativeCallableMethodArguments(protocol: RustNativeCallableProtocolResultInput): readonly RustTargetGenericArgument[] {
  return Object.freeze([...protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime" as const,
    lifetime: parameter.lifetime })), ...rustTypeGenericArguments(protocol.signature.typeParameters)]);
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

function nativeCallableProtocolResult(
  protocol: RustNativeCallableProtocolResultInput,
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const self: TargetTypeRef = { kind: "type-parameter", identity: `${protocol.identity}:Self`, name: "Self" };
  const arguments_ = nativeCallableMethodArguments(protocol);
  const captures = [...arguments_.filter(argument => argument.kind === "lifetime"),
    ...rustTypeGenericArguments([self, ...protocol.signature.environmentParameters,
      ...protocol.signature.typeParameters])];
  const error = (name: string): TargetTypeRef => ({ kind: "associated-type", owner: self, name, genericArguments: arguments_ });
  const completion = protocol.completion === undefined ? protocol.method.result :
    instantiateRustNativeCompletion(protocol.completion, future =>
      future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId
        ? rustJsPromiseOutputTargetType(future.carrier) === undefined ? undefined : future.carrier
        : rustNativeCompletionFutureType({ identity: `${protocol.identity}:future:${future.ordinal}`,
          output: future.output, error: error(`AwaitError${future.ordinal}`), captures }), definitions);
  return completion === undefined ? undefined : rustNamedTargetType(`${protocol.identity}:result`, "Result",
    rustTypeGenericArguments([completion, error("InvocationError")]));
}

export function assertRustNativeCallableProtocolResults(
  protocols: readonly RustNativeCallableProtocol[],
  definitions: RustTypeDefinitions,
): void {
  for (const protocol of protocols) {
    const result = nativeCallableProtocolResult(protocol, definitions);
    if (result === undefined || !rustTargetTypeRefEquals(result, protocol.result))
      failTargetAnalysisInvariant("tsonic-rust",
        "A sealed native callable protocol result differs from its exact admitted result.");
  }
}
