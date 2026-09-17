import { rustOptionElementCarrier } from "../../target-model/types/index.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "./keys.js";
import { isRustFinalizedSourceInput, validateRustFinalizedOperationAbi } from "./finalized-operation-abi.js";

export function rustIndexedLocationContract(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
) {
  const abi = fact.abi;
  const index = abi.targetArguments[0];
  if (fact.indexedLocationMethod === undefined ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(fact.indexedLocationMethod) ||
      !validateRustFinalizedOperationAbi(abi, definitions) || abi.operationKind !== "indexer" ||
      abi.effects.invocation !== "infallible" || abi.effects.safety !== "safe" ||
      abi.result.kind !== "sync" || abi.result.conversion.kind !== "identity" ||
      abi.target.form !== "receiver-method" || abi.targetGenericArguments.length !== 0 ||
      abi.sourceReceiver.kind !== "receiver" || abi.sourceReceiver.disposition !== "runtime" ||
      abi.sourceArguments.length !== 1 || abi.sourceArguments[0]?.disposition !== "runtime" ||
      abi.targetReceiver.kind !== "input" || abi.targetReceiver.input.source.kind !== "receiver" ||
      abi.targetReceiver.input.mode !== "ref" ||
      abi.targetReceiver.input.conversion.kind !== "identity" ||
      abi.targetArguments.length !== 1 || index === undefined ||
      !isRustFinalizedSourceInput(index) || index.source.kind !== "argument" ||
      index.source.sourceIndex !== 0 || index.mode !== "value" ||
      fact.sourceResultCarrier === undefined ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(abi.result.carrier), fact.sourceResultCarrier)) {
    return undefined;
  }
  return {
    method: fact.indexedLocationMethod,
    index,
    receiverCarrier: abi.sourceReceiver.carrier,
    pointeeCarrier: fact.sourceResultCarrier,
  };
}
