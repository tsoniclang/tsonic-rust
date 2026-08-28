import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFutureOutputCarrier } from "../../target-model/types/index.js";
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
    if (!validateRustFinalizedOperationAbi(operation.abi)) {
      return undefined;
    }
    const awaiting = operation.abi.effects.awaiting;
    if (awaiting === "not-applicable") {
      return undefined;
    }
    const outputCarrier = operation.abi.result.kind === "async"
      ? operation.abi.result.awaitedCarrier
      : rustFutureOutputCarrier(operation.abi.result.carrier);
    if (outputCarrier === undefined) {
      return undefined;
    }
    return {
      outputCarrier,
      awaitedConversion: operation.abi.result.kind === "async"
        ? operation.abi.result.awaitedConversion
        : {
            kind: "identity",
            sourceCarrier: outputCarrier,
            targetCarrier: outputCarrier,
            fallible: false,
          },
      awaiting,
      errorBoundary: operation.abi.effects.errorBoundary,
      ...(operation.abi.effects.errorCarrier === undefined
        ? {}
        : { errorCarrier: operation.abi.effects.errorCarrier }),
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
    (fact.errorBoundary === "provider-native"
      ? fact.errorCarrier !== undefined
      : fact.errorCarrier === undefined) &&
    rustTargetTypeRefEquals(rustFutureOutputCarrier(carrier), fact.outputCarrier) &&
    rustTargetTypeRefEquals(fact.awaitedConversion.targetCarrier, fact.outputCarrier);
}
