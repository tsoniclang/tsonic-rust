import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeCallableProtocol } from "../../target-model/records/native-protocols.js";
import type { RustNativeProducerBridge } from "../../target-model/records/native-protocol-emission.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../target-model/types/callable-completions.js";
import { rustFutureTargetId } from "../../target-model/types/carriers/primitives.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export function analyzeRustNativeProducerBridge(protocol: RustNativeCallableProtocol, definitions: RustTypeDefinitions): RustNativeProducerBridge | undefined {
  const signature = protocol.signature;
  if (signature.typeParameters.length !== 0) return undefined;
  const bound = protocol.method.binder.parameters.length !== 0;
  if (bound && protocol.boundProducerName === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted higher-ranked protocol requires its exact bound producer name.");
  const names = new Set(protocol.environmentParameters.flatMap(argument =>
    argument.kind === "type" && argument.type.kind === "type-parameter" ? [argument.type.name] : []));
  const parameter = (preferred: string): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> => Object.freeze({
    kind: "type-parameter", identity: `${protocol.identity}:producer:${preferred}`, name: allocateRustGeneratedName(names, preferred),
  });
  const implementation = parameter("Implementation");
  const invocationError = parameter("InvocationError");
  const futures = protocol.completion?.futures ?? [];
  const errors = new Map(futures.filter(future => rustJsPromiseOutputTargetType(future.carrier) === undefined)
    .map(future => [future.ordinal, parameter(`AwaitError${future.ordinal}`)]));
  const pending = new Map(futures.filter(future => future.carrier.kind === "target-named" && future.carrier.id === rustFutureTargetId)
    .map(future => [future.ordinal, parameter(`Pending${future.ordinal}`)]));
  const argumentsParameter = parameter("Arguments");
  const outputs = new Map<string, { readonly source: TargetTypeRef; readonly parameter: Extract<TargetTypeRef, { readonly kind: "type-parameter" }> }>();
  if (bound) for (const source of protocol.completion === undefined ? [protocol.method.result]
    : rustAwaitSelectionLeaves(protocol.completion.selection).map(leaf => leaf.future?.outputCarrier ?? leaf.carrier)) {
    const identity = closedMetadataKey(source);
    if (!outputs.has(identity)) outputs.set(identity, Object.freeze({ source, parameter: parameter(`Output${outputs.size}`) }));
  }
  const boundTypes = Object.freeze([argumentsParameter, ...[...outputs.values()].map(output => output.parameter)]);
  const genericArguments: readonly RustTargetGenericArgument[] = Object.freeze([
    ...bound ? [] : protocol.environmentParameters.filter(argument => argument.kind === "lifetime"),
    ...rustTypeGenericArguments([implementation]),
    ...bound ? rustTypeGenericArguments(boundTypes) : protocol.environmentParameters.filter(argument => argument.kind !== "lifetime"),
    ...rustTypeGenericArguments([invocationError, ...errors.values(), ...pending.values()]),
  ]);
  const bindOutputs = (carrier: TargetTypeRef): TargetTypeRef => outputs.size === 0 ? carrier
    : mapRustTargetTypes(carrier, (type, source) => outputs.get(closedMetadataKey(source))?.parameter ?? type);
  const targetLifetimes: readonly RustTargetGenericArgument[] = protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime", lifetime: parameter.lifetime }));
  const result = (error: TargetTypeRef, awaitError: (ordinal: number) => TargetTypeRef, captures: readonly RustTargetGenericArgument[] | undefined): TargetTypeRef => {
    const completion = protocol.completion === undefined ? protocol.method.result : instantiateRustNativeCompletion(protocol.completion, future => {
      if (future.carrier.kind !== "target-named") return undefined;
      if (future.carrier.id === rustJsPromiseTargetId) return rustJsPromiseOutputTargetType(future.carrier) === undefined ? undefined : future.carrier;
      if (future.carrier.id !== rustFutureTargetId) return undefined;
      return captures === undefined ? pending.get(future.ordinal) : rustNativeCompletionFutureType({
        identity: `${protocol.identity}:producer:future:${future.ordinal}`, output: future.output, error: awaitError(future.ordinal), captures,
      });
    }, definitions);
    if (completion === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native producer requires its exact completed result carrier.");
    return rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([bindOutputs(completion), error]));
  };
  const concreteResult = result(invocationError, ordinal => errors.get(ordinal)!, undefined);
  const implementationResult = result(invocationError, ordinal => errors.get(ordinal)!, [...targetLifetimes, ...genericArguments]);
  let higherRanked: RustNativeProducerBridge["higherRanked"];
  if (bound) {
    const self: TargetTypeRef = { kind: "type-parameter", identity: `${protocol.identity}:Self`, name: "Self" };
    const associated = (name: string): TargetTypeRef => ({ kind: "associated-type", owner: self, name, genericArguments: [] });
    const helperResult = result(associated("InvocationError"), ordinal => associated(`AwaitError${ordinal}`), [...targetLifetimes, ...rustTypeGenericArguments([self, ...boundTypes])]);
    const publicResult = mapRustTargetTypes(protocol.result, type => type.kind !== "impl-trait" ? type : { ...type,
      captures: type.captures?.map(argument => argument.kind === "type" && argument.type.kind === "type-parameter" && argument.type.identity === self.identity
        ? { kind: "type", type: implementation } : argument),
    });
    higherRanked = Object.freeze({ helperResult, publicResult, outputs: Object.freeze([...outputs.values()].map(output => output.source)) });
  }
  return Object.freeze({ implementation, invocationError, arguments: argumentsParameter, genericArguments, boundTypes,
    errors: Object.freeze([...errors].map(([ordinal, parameter]) => Object.freeze({ ordinal, parameter }))),
    futureBounds: Object.freeze(futures.flatMap(future => {
      const selected = pending.get(future.ordinal);
      if (selected === undefined) return [];
      const error = errors.get(future.ordinal);
      if (error === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted pending producer requires its exact rejection parameter.");
      return [Object.freeze({ parameter: selected, output: bindOutputs(future.output), error })];
    })), concreteResult, implementationResult, higherRanked });
}
