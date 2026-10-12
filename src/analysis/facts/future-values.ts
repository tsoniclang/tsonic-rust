import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFutureOutputCarrier, rustAwaitCarrier, rustJsPromiseTargetId, isRustProgramErrorCarrier } from "../../target-model/types/index.js";
import { validateRustFinalizedOperationAbi } from "./finalized-operation-abi.js";
import { finalizedConversionIsValid, finalizeValueConversion } from "./finalized-operation/conversions.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { hasExactObjectKeys, isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type {
  RustFutureValueFact,
  RustSourceCallEffectsFact,
  RustTargetOperationFact,
} from "./keys.js";

export function rustFutureValueForOperation(
  operation: RustTargetOperationFact | undefined,
  sourceCallEffects?: RustSourceCallEffectsFact,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustFutureValueFact | undefined {
  if (operation?.kind === "provider-operation") {
    if (!validateRustFinalizedOperationAbi(operation.abi, definitions)) {
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
    (sourceCallEffects.invocation !== "infallible" && sourceCallEffects.invocation !== "fallible") ||
    sourceCallEffects.awaiting === "not-applicable") {
    return undefined;
  }
  const outputCarrier = rustAwaitCarrier(operation.resultCarrier)?.outputCarrier;
  if (outputCarrier === undefined) {
    return undefined;
  }
  if (sourceCallEffects.nativeInput !== undefined) return rustNativeFutureValueForSourceCallBranch(
    operation, sourceCallEffects, operation.resultCarrier, definitions);
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

export function rustNativeFutureValueForSourceCallBranch(
  operation: RustTargetOperationFact | undefined,
  effects: RustSourceCallEffectsFact | undefined,
  branch: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustFutureValueFact | undefined {
  if (operation?.kind !== "source-call" || effects?.nativeInput === undefined || effects.awaiting !== "fallible") return undefined;
  const completion = rustNativeCallableCompletion(operation.resultCarrier, definitions);
  const future = completion?.futures.find(future => rustTargetTypeRefEquals(future.carrier, branch));
  const errorCarrier = future === undefined ? undefined : effects.nativeInput.awaitErrors[future.ordinal];
  const errorSource = future === undefined ? undefined : effects.nativeInput.awaitErrorSources[future.ordinal];
  if (completion === undefined || completion.futures.length !== effects.nativeInput.awaitErrors.length ||
    completion.futures.length !== effects.nativeInput.awaitErrorSources.length ||
    future === undefined || !isRustTargetTypeRef(errorCarrier) || typeof errorSource !== "string" || errorSource.length === 0) return undefined;
  return { outputCarrier: future.output,
    awaitedConversion: { kind: "identity", sourceCarrier: future.output, targetCarrier: future.output, fallible: false },
    awaiting: "fallible", errorBoundary: "source-native", errorCarrier, errorSource };
}

export function rustFutureValueForSourceStorage(carrier: TargetTypeRef | undefined): RustFutureValueFact | undefined {
  const selected = rustAwaitCarrier(carrier);
  const future = selected?.futureCarrier;
  const error = future?.kind === "target-named" ? future.genericArguments?.[2] : undefined;
  if (selected === undefined || future?.kind !== "target-named" || future.id !== rustJsPromiseTargetId ||
    error?.kind !== "type" || !isRustProgramErrorCarrier(error.type)) return undefined;
  return {
    outputCarrier: selected.outputCarrier,
    awaitedConversion: { kind: "identity", sourceCarrier: selected.outputCarrier,
      targetCarrier: selected.outputCarrier, fallible: false },
    awaiting: "fallible", errorBoundary: "source-program",
  };
}

export function rustFutureValuesForSourceStorage(
  carrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): readonly RustFutureValueFact[] | undefined {
  const selection = rustAwaitSelection(carrier, definitions);
  return selection === undefined ? undefined : rustAwaitSelectionLeaves(selection).flatMap(leaf => {
    const future = leaf.future === undefined ? undefined : rustFutureValueForSourceStorage(leaf.carrier);
    return future === undefined ? [] : [future];
  });
}

export function rustFutureValueMatchesCarrier(
  fact: RustFutureValueFact,
  carrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  return carrier !== undefined && fact !== null && typeof fact === "object" && isClosedMetadata(fact) && hasExactObjectKeys(fact,
    fact.errorBoundary === "source-native" ? ["outputCarrier", "awaitedConversion", "awaiting", "errorBoundary", "errorCarrier", "errorSource"]
      : fact.errorCarrier === undefined ? ["outputCarrier", "awaitedConversion", "awaiting", "errorBoundary"]
      : ["outputCarrier", "awaitedConversion", "awaiting", "errorBoundary", "errorCarrier"]) &&
    finalizedConversionIsValid(fact.awaitedConversion, definitions) &&
    ((fact.awaiting === "infallible" && fact.errorBoundary === "none") ||
      (fact.awaiting === "fallible" && (fact.errorBoundary === "source-program" ||
        fact.errorBoundary === "target-runtime" || fact.errorBoundary === "provider-native" || fact.errorBoundary === "source-native"))) &&
    (fact.errorBoundary === "provider-native" || fact.errorBoundary === "source-native"
      ? isRustTargetTypeRef(fact.errorCarrier)
      : fact.errorCarrier === undefined) &&
    (fact.errorBoundary === "source-native" ? typeof fact.errorSource === "string" && fact.errorSource.length > 0
      : fact.errorSource === undefined) &&
    rustTargetTypeRefEquals(rustAwaitCarrier(carrier)?.outputCarrier, fact.outputCarrier) &&
    rustTargetTypeRefEquals(fact.awaitedConversion.targetCarrier, fact.outputCarrier);
}

export function transportRustFutureValue(
  fact: RustFutureValueFact,
  sourceCarrier: TargetTypeRef | undefined,
  targetCarrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustFutureValueFact | undefined {
  if (sourceCarrier === undefined || targetCarrier === undefined ||
    !rustFutureValueMatchesCarrier(fact, sourceCarrier, definitions) ||
    !rustNativeRepresentationMatches(sourceCarrier, targetCarrier)) return undefined;
  const outputCarrier = rustAwaitCarrier(targetCarrier)?.outputCarrier;
  if (outputCarrier === undefined) return undefined;
  if (rustTargetTypeRefEquals(outputCarrier, fact.outputCarrier)) return fact;
  if (fact.awaitedConversion.kind !== "identity") return undefined;
  const awaitedConversion = finalizeValueConversion({
    kind: "native-representation", source: fact.outputCarrier, target: outputCarrier,
  }, fact.outputCarrier, outputCarrier);
  return awaitedConversion === undefined ? undefined : { ...fact, outputCarrier, awaitedConversion };
}
