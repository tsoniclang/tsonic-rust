import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustCallablePhysicalSignature, type RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import type { RustTargetGenericArgument, RustTargetGenericParameter, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue, rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustOnlyTypeGenericArguments, rustTargetGenericBindingsForArguments, rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import type { RustNativeCallableInput } from "./native-inputs.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "./native-storage.js";
import { rustNativeCallableProtocolResult } from "./native-protocols.js";
import { rustCallableSignatureAbsenceWitness } from "../../target-model/types/carriers/callable-input-witness.js";
import { instantiateRustNativeCompletion } from "../../target-model/types/callable-completions.js";
import { rustJsPromiseTargetTypeWithLifetime } from "../../target-model/types/carriers/js.js";
import { rustInfallibleTargetId, rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";

export function rustNativeCallableAbsenceWitness(
  input: RustNativeCallableInput, definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const protocol = input.protocol;
  if (protocol.signature.typeParameters.length !== 0) return undefined;
  const infallible: TargetTypeRef = { kind: "target-named", id: rustInfallibleTargetId };
  const result = protocol.completion === undefined ? protocol.method.result : instantiateRustNativeCompletion(protocol.completion, future => {
    if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
      const lifetime = future.carrier.genericArguments?.[0];
      return lifetime?.kind !== "lifetime" ? undefined : rustJsPromiseTargetTypeWithLifetime(future.output, lifetime.lifetime, infallible);
    }
    return rustNamedTargetType("rust.core.future.Ready", "core::future::Ready", rustTypeGenericArguments([
      rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future.output, infallible])),
    ]));
  }, definitions);
  if (result === undefined) return undefined;
  const witness = rustCallableSignatureAbsenceWitness(protocol.method.parameters,
    rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([result, infallible])), protocol.method.binder);
  return snapshotClosedMetadata(substituteRustTargetGenerics(witness, new Map(protocol.signature.environmentParameters.map((parameter, index) =>
    [parameter.identity, input.environment[index]!])), new Map()));
}

export interface RustNativeCallablePhysicalSource {
  readonly carrier: TargetTypeRef;
  readonly signature: RustCallablePhysicalSignature;
  readonly input?: RustNativeCallableInput;
}

export function rustNativeCallablePhysicalSource(
  source: TargetTypeRef,
  storage: RustNativeStorageSelection,
  definitions: RustTypeDefinitions,
): RustNativeCallablePhysicalSource | undefined {
  if (storage.kind === "unresolved") return undefined;
  const signature = rustCallablePhysicalSignature(storage.carrier);
  if (signature !== undefined) return Object.freeze({ carrier: storage.carrier, signature });
  const inputs = storage.kind === "selected" ? storage.inputs.filter(input =>
    rustTargetTypeRefEquals(input.implementation, storage.carrier)) : [];
  if (inputs.length !== 1) return undefined;
  const input = inputs[0]!;
  const protocol = input.protocol;
  if (!rustTargetTypeRefEquals(input.carrier, source) || protocol.signature.typeParameters.length !== 0 ||
    protocol.method.binder.parameters.length !== 0) return undefined;
  const selected = rustNativeCallableInputPhysicalSignature(input, [], definitions);
  return selected === undefined ? undefined : Object.freeze({ carrier: storage.carrier, input, signature: selected });
}

export function rustNativeCallableInputPhysicalSignature(
  input: RustNativeCallableInput,
  methodArguments: readonly RustTargetGenericArgument[],
  definitions: RustTypeDefinitions,
): RustCallablePhysicalSignature | undefined {
  const protocol = input.protocol;
  const parameters: readonly RustTargetGenericParameter[] = [
    ...protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime" as const,
      sourceName: parameter.lifetime.name, targetIdentity: rustLifetimeKey(parameter.lifetime) })),
    ...protocol.signature.typeParameters.map(parameter => ({ kind: "type" as const,
      sourceName: parameter.name, targetIdentity: parameter.identity })),
    ...protocol.signature.environmentParameters.map(parameter => ({ kind: "type" as const,
      sourceName: parameter.name, targetIdentity: parameter.identity })),
  ];
  if (methodArguments.length !== protocol.method.binder.parameters.length + protocol.signature.typeParameters.length ||
    input.environment.length !== protocol.signature.environmentParameters.length || input.trait.id !== protocol.identity) return undefined;
  const arguments_ = [...methodArguments, ...input.environment.map(type => ({ kind: "type" as const, type }))];
  const bindings = rustTargetGenericBindingsForArguments(parameters, arguments_);
  if (bindings === undefined) return undefined;
  const selectedResult = rustNativeCallableProtocolResult(protocol, definitions);
  if (selectedResult === undefined) return undefined;
  const result = substituteRustTargetGenerics(selectedResult, bindings.types, bindings.lifetimes, bindings.consts, (carrier, original) => {
    if (carrier.kind === "associated-type" && original.kind === "associated-type" && original.owner.kind === "type-parameter" &&
      original.owner.identity === `${protocol.identity}:Self`) return { ...carrier, owner: input.implementation, trait: input.trait };
    return carrier.kind === "type-parameter" && carrier.identity === `${protocol.identity}:Self` ? input.implementation : carrier;
  });
  const resultArguments = rustOnlyTypeGenericArguments(rustNamedTypeCarrierValue(result)?.genericArguments);
  return resultArguments?.length !== 2 ? undefined : snapshotClosedMetadata({
    parameters: Object.freeze(protocol.method.parameters.map(parameter =>
      substituteRustTargetGenerics(parameter, bindings.types, bindings.lifetimes, bindings.consts))),
    result: resultArguments[0]!, error: resultArguments[1]!,
  });
}

export function rustNativeCallableOperand(
  source: TargetTypeRef,
  node: Node,
  input: {
    readonly records: RustProgramRecords;
    readonly storage: RustNativeStoragePlan;
    readonly producers: RustNativeCallableProducerPlan;
    readonly definitions: RustTypeDefinitions;
  },
): RustNativeCallablePhysicalSource | undefined {
  const reference = input.records.directCallableReference.get(node);
  if (reference !== undefined) {
    if (!rustTargetTypeRefEquals(reference.carrier, source)) return undefined;
    const carrier = input.producers.physicalFor(reference.sourceDeclaration, source);
    return carrier === undefined ? undefined
      : rustNativeCallablePhysicalSource(source, { kind: "identity", carrier }, input.definitions);
  }
  if (!rustTargetTypeRefEquals(rustValueCarrierBeforeContextualConversion(input.records, node), source)) return undefined;
  return rustNativeCallablePhysicalSource(source, input.storage.operandFor(node), input.definitions);
}
