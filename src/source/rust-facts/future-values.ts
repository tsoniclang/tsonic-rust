import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustFutureOutputCarrier, rustFutureTargetType } from "../rust-target-types.js";
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
      errorBoundary: operation.abi.effects.errorBoundary,
    };
  }
  if (operation?.kind !== "source-call" || sourceCallEffects === undefined ||
    sourceCallEffects.invocation !== "infallible" ||
    sourceCallEffects.awaiting === "not-applicable") {
    return undefined;
  }
  const outputCarrier = rustFutureOutputCarrier(operation.resultCarrier);
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
    errorBoundary: sourceCallEffects.awaiting === "fallible" ? "source-program" : "none",
  };
}

export function rustFutureValueMatchesCarrier(
  fact: RustFutureValueFact,
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier !== undefined &&
    ((fact.awaiting === "infallible" && fact.errorBoundary === "none") ||
      (fact.awaiting === "fallible" && fact.errorBoundary !== "none")) &&
    rustTargetTypeRefEquals(carrier, rustFutureTargetType(fact.outputCarrier)) &&
    rustTargetTypeRefEquals(fact.awaitedConversion.targetCarrier, fact.outputCarrier);
}
