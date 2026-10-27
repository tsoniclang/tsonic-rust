import { rustCallablePhysicalSignature, type RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import type { RustNativeCallablePhysicalSource } from "../../target-model/records/callable-conversions.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue, rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import type { RustNativeCallableInput } from "../../target-model/records/native-protocols.js";

import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";
import { rustCallableSignatureAbsenceWitness } from "../../target-model/types/carriers/callable-input-witness.js";
import { instantiateRustNativeCompletion } from "../../target-model/types/callable-completions.js";
import { rustJsPromiseTargetType } from "../../target-model/types/carriers/promises.js";
import { rustInfallibleTargetId, rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustFrameCallableProtocol } from "../../target-model/types/carriers/frame-callables.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import { rustGenericCallablePhysicalBindings } from "../types/callables/generic-bindings.js";

export function rustNativeCallableAbsenceWitness(
  input: RustNativeCallableInput, definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const protocol = input.protocol;
  if (protocol.signature.typeParameters.length !== 0) return undefined;
  const infallible: TargetTypeRef = { kind: "target-named", id: rustInfallibleTargetId };
  const result = protocol.completion === undefined ? protocol.method.result : instantiateRustNativeCompletion(protocol.completion, future => {
    if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
      return rustJsPromiseTargetType(future.output);
    }
    return rustNamedTargetType("rust.core.future.Ready", "core::future::Ready", rustTypeGenericArguments([
      rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future.output, infallible])),
    ]));
  }, definitions);
  if (result === undefined) return undefined;
  const witness = rustCallableSignatureAbsenceWitness(protocol.method.parameters,
    rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([result, infallible])), protocol.method.binder);
  const bindings = rustGenericCallablePhysicalBindings(protocol.environmentParameters, input.environment);
  return bindings === undefined ? undefined : snapshotClosedMetadata(substituteRustTargetGenerics(witness,
    bindings.types, bindings.lifetimes, bindings.consts));
}

export function rustNativeCallablePhysicalSource(
  source: TargetTypeRef,
  storage: Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }>
    | Pick<Extract<RustNativeStorageSelection, { readonly kind: "identity" }>, "kind" | "carrier">
    | Pick<Extract<RustNativeStorageSelection, { readonly kind: "selected" }>, "kind" | "carrier" | "inputs" | "erased">,
  frames: Pick<RustFrameCallablePlan, "errorFor">,
): RustNativeCallablePhysicalSource | undefined {
  if (storage.kind === "unresolved") return undefined;
  const signature = rustCallablePhysicalSignature(storage.carrier) ?? rustFramePhysicalSignature(storage.carrier, frames);
  if (signature !== undefined) return Object.freeze({ carrier: storage.carrier, signature,
    ...(storage.kind === "selected" && storage.erased === true ? { erased: true as const } : {}) });
  const inputs = storage.kind === "selected" ? storage.inputs.filter(input =>
    rustTargetTypeRefEquals(input.implementation, storage.carrier)) : [];
  if (inputs.length !== 1) return undefined;
  const input = inputs[0]!;
  const protocol = input.protocol;
  if (!rustTargetTypeRefEquals(input.carrier, source) || protocol.signature.typeParameters.length !== 0 ||
    protocol.method.binder.parameters.length !== 0) return undefined;
  const selected = rustNativeCallableInputPhysicalSignature(input, []);
  return selected === undefined ? undefined : Object.freeze({ carrier: storage.carrier, input, signature: selected });
}

export function rustNativeCallableInputPhysicalSignature(
  input: RustNativeCallableInput,
  methodArguments: readonly RustTargetGenericArgument[],
): RustCallablePhysicalSignature | undefined {
  const protocol = input.protocol;
  const parameters: readonly RustTargetGenericArgument[] = [
    ...protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime" as const, lifetime: parameter.lifetime })),
    ...rustTypeGenericArguments(protocol.signature.typeParameters),
    ...protocol.environmentParameters,
  ];
  if (methodArguments.length !== protocol.method.binder.parameters.length + protocol.signature.typeParameters.length ||
    input.trait.id !== protocol.identity) return undefined;
  const arguments_ = [...methodArguments, ...input.environment];
  const bindings = rustGenericCallablePhysicalBindings(parameters, arguments_);
  if (bindings === undefined) return undefined;
  const selectedResult = protocol.result;
  const result = substituteRustTargetGenerics(selectedResult, bindings.types, bindings.lifetimes, bindings.consts, (carrier, original) => {
    if (carrier.kind === "associated-type" && original.kind === "associated-type" && original.owner.kind === "type-parameter" &&
      original.owner.identity === `${protocol.identity}:Self`) return { ...carrier, owner: input.implementation, trait: input.trait };
    return carrier.kind === "type-parameter" && carrier.identity === `${protocol.identity}:Self` ? input.implementation : carrier;
  });
  const resultValue = rustNamedTypeCarrierValue(result);
  const resultArguments = resultValue?.id === "rust.core.Result"
    ? rustOnlyTypeGenericArguments(resultValue.genericArguments) : undefined;
  return resultArguments?.length !== 2 ? undefined : snapshotClosedMetadata({
    parameters: Object.freeze(protocol.method.parameters.map(parameter =>
      substituteRustTargetGenerics(parameter, bindings.types, bindings.lifetimes, bindings.consts))),
    result: resultArguments[0]!, error: resultArguments[1]!,
  });
}

/** The physical Future of an optional Future slot that only ever holds absence: a never-created ready future with the
 * slot's output, the same witness form absent native callables use for their completions. */
export function rustAbsentFutureWitness(output: TargetTypeRef): TargetTypeRef {
  return snapshotClosedMetadata(rustNamedTargetType("rust.core.future.Ready", "core::future::Ready", rustTypeGenericArguments([
    rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([output, { kind: "target-named", id: rustInfallibleTargetId }])),
  ])));
}

function rustFramePhysicalSignature(carrier: TargetTypeRef,
  frames: Pick<RustFrameCallablePlan, "errorFor">): RustCallablePhysicalSignature | undefined {
  const protocol = rustFrameCallableProtocol(carrier);
  const error = protocol === undefined ? undefined : frames.errorFor(carrier);
  return protocol === undefined || error === undefined ? undefined
    : Object.freeze({ parameters: protocol.parameters, result: protocol.result, error });
}
