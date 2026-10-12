import type { Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustCallablePhysicalSignature, type RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustOnlyTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustDirectCallableReferenceFactKey } from "../facts/keys.js";
import { rustValueCarrierBeforeContextualConversion } from "../facts/value-carrier-queries.js";
import type { RustNativeCallableInput } from "./native-inputs.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "./native-storage.js";
import { rustNativeCallableProtocolResult } from "./native-protocols.js";

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
  if (!rustTargetTypeRefEquals(input.carrier, source) || protocol.binding.signature.typeParameters.length !== 0 ||
    protocol.method.binder.parameters.length !== 0) return undefined;
  const types = new Map(protocol.binding.signature.environmentParameters.map((parameter, index) =>
    [parameter.identity, protocol.binding.environment[index]!]));
  const selectedResult = rustNativeCallableProtocolResult(protocol, definitions);
  if (selectedResult === undefined) return undefined;
  const result = mapRustTargetTypes(substituteRustTargetTypeParameters(selectedResult, types), (carrier, original) => {
    if (carrier.kind === "associated-type" && original.kind === "associated-type" && original.owner.kind === "type-parameter" &&
      original.owner.identity === `${protocol.identity}:Self`) return { ...carrier, owner: input.implementation, trait: protocol.trait };
    return carrier.kind === "type-parameter" && carrier.identity === `${protocol.identity}:Self` ? input.implementation : carrier;
  });
  const arguments_ = rustOnlyTypeGenericArguments(rustNamedTypeCarrierValue(result)?.genericArguments);
  return arguments_?.length !== 2 ? undefined : Object.freeze({ carrier: storage.carrier, input,
    signature: Object.freeze({ parameters: Object.freeze(protocol.method.parameters.map(parameter =>
      substituteRustTargetTypeParameters(parameter, types))), result: arguments_[0]!, error: arguments_[1]! }),
  });
}

export function rustNativeCallableOperand(
  source: TargetTypeRef,
  node: Node,
  input: {
    readonly facts: RustPlanQueries;
    readonly storage: RustNativeStoragePlan;
    readonly producers: RustNativeCallableProducerPlan;
    readonly definitions: RustTypeDefinitions;
  },
): RustNativeCallablePhysicalSource | undefined {
  const reference = input.facts.getFact(node, rustDirectCallableReferenceFactKey);
  if (reference !== undefined) {
    if (!rustTargetTypeRefEquals(reference.carrier, source)) return undefined;
    const carrier = input.producers.physicalFor(reference.sourceDeclaration, source);
    return carrier === undefined ? undefined
      : rustNativeCallablePhysicalSource(source, { kind: "identity", carrier }, input.definitions);
  }
  if (!rustTargetTypeRefEquals(rustValueCarrierBeforeContextualConversion(input.facts, node), source)) return undefined;
  return rustNativeCallablePhysicalSource(source, input.storage.operandFor(node), input.definitions);
}
