import { rustOptionElementCarrier } from "../../target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { isRustFinalizedConstantInput, isRustFinalizedSourceInput } from "./finalized-operation/conversions.js";
import { validateRustFinalizedOperationAbi } from "./finalized-operation/validation.js";
import type { RustFinalizedOperationAbi, RustFinalizedSourceInput, RustFinalizedConstantInput } from "../../target-model/records/finalized-operation.js";

export function rustFinalizedIndexInput(abi: RustFinalizedOperationAbi): RustFinalizedSourceInput | RustFinalizedConstantInput | undefined {
  const index = abi.targetArguments[0];
  const source = abi.sourceArguments[0];
  if (abi.operationKind !== "indexer" || abi.targetArguments.length !== 1 || abi.sourceArguments.length !== 1 ||
    source?.sourceIndex !== 0 || source.form !== "value" || source.mode !== "value" || index === undefined) return undefined;
  if (isRustFinalizedConstantInput(index)) return source.disposition === "evaluation-only" && source.role === "evaluation-only"
    ? index : undefined;
  return isRustFinalizedSourceInput(index) && index.source.kind === "argument" && index.source.sourceIndex === 0 &&
    index.mode === "value" && source.disposition === "runtime" && source.role === "index" &&
    rustTargetTypeRefEquals(index.sourceCarrier, source.carrier) ? index : undefined;
}

export function rustIndexedLocationContract(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
) {
  const abi = fact.abi;
  const index = rustFinalizedIndexInput(abi);
  if (fact.indexedLocationMethod === undefined ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(fact.indexedLocationMethod) ||
      !validateRustFinalizedOperationAbi(abi, definitions) || abi.operationKind !== "indexer" ||
      abi.effects.invocation !== "infallible" || abi.effects.safety !== "safe" ||
      abi.result.kind !== "sync" ||
      (abi.result.conversion.kind !== "identity" &&
        (abi.result.conversion.kind !== "semantic" || abi.result.conversion.conversion.kind !== "source-optional" ||
          !rustTargetTypeRefEquals(abi.result.conversion.conversion.element, fact.sourceResultCarrier))) ||
      abi.target.form !== "receiver-method" || abi.targetGenericArguments.length !== 0 ||
      abi.sourceReceiver.kind !== "receiver" || abi.sourceReceiver.disposition !== "runtime" ||
      abi.targetReceiver.kind !== "input" || abi.targetReceiver.input.source.kind !== "receiver" ||
      abi.targetReceiver.input.mode !== "ref" ||
      abi.targetReceiver.input.conversion.kind !== "identity" ||
      index === undefined ||
      fact.sourceResultCarrier === undefined ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(abi.result.rawCarrier), fact.sourceResultCarrier)) {
    return undefined;
  }
  return {
    method: fact.indexedLocationMethod,
    index,
    receiverCarrier: abi.sourceReceiver.carrier,
    pointeeCarrier: fact.sourceResultCarrier,
  };
}
