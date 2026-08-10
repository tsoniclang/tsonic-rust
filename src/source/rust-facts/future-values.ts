import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustFutureTargetType } from "../rust-target-types.js";
import { validateRustFinalizedOperationAbi } from "./finalized-operation-abi.js";
import type {
  RustFutureValueFact,
  RustSourceCallEffectsFact,
  RustTargetOperationFact,
} from "./keys.js";

export function rustFutureValueForOperation(
  operation: RustTargetOperationFact | undefined,
  sourceCallEffects?: RustSourceCallEffectsFact,
): RustFutureValueFact | undefined {
  if (operation?.kind === "provider-operation") {
    if (!validateRustFinalizedOperationAbi(operation.abi) || operation.abi.result.kind !== "async") {
      return undefined;
    }
    const awaiting = operation.abi.effects.awaiting;
    if (awaiting === "not-applicable") {
      return undefined;
    }
    return {
      outputCarrier: operation.abi.result.awaitedCarrier,
      awaitedConversion: operation.abi.result.awaitedConversion,
      awaiting,
    };
  }
  if (operation?.kind !== "source-call" || sourceCallEffects === undefined ||
    sourceCallEffects.invocation !== "infallible" ||
    sourceCallEffects.awaiting === "not-applicable") {
    return undefined;
  }
  const outputCarrier = operation.resultCarrier.kind === "target-named" &&
      operation.resultCarrier.id === "rust.core.Future"
    ? operation.resultCarrier.typeArguments?.[0]
    : undefined;
  if (outputCarrier === undefined) {
    return undefined;
  }
  return {
    outputCarrier,
    awaitedConversion: {
      kind: "identity",
      sourceCarrier: outputCarrier,
      targetCarrier: outputCarrier,
      fallible: false,
    },
    awaiting: sourceCallEffects.awaiting,
  };
}

export function rustFutureValueMatchesCarrier(
  fact: RustFutureValueFact,
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier !== undefined &&
    rustTargetTypeRefEquals(carrier, rustFutureTargetType(fact.outputCarrier)) &&
    rustTargetTypeRefEquals(fact.awaitedConversion.targetCarrier, fact.outputCarrier);
}
