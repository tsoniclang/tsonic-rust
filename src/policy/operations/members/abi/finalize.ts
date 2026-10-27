import { emptyRustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { createInputFactory, finalizeSourceArguments, finalizeTargetInputs } from "./inputs.js";
import { declaredCarriersMatch, finalizeValueConversion } from "./conversions.js";
import { isRustFinalizedArrayInput, isRustFinalizedSliceInput, isRustFinalizedTaggedArrayInput, rustFinalizedTargetInputMayMutateSource } from "../../../../target-model/operations/finalized-inputs.js";
import { isDenseDataArray, snapshotClosedMetadata } from "../../../../target-model/metadata/closed-data.js";
import { isRustAwaitedErrorBoundary, isRustFallibleErrorBoundary } from "../../../../target-model/operations/error-boundary.js";
import { rustRestSequenceForm } from "../../../../target-model/operations/rest-assembly.js";
import { isRustTargetGenericArgument, isRustTargetTypeRef } from "../../../../target-model/types/equality.js";
import { operationKinds, validateRustFinalizedOperationAbi } from "./validation.js";
import { rustFutureOutputCarrier, rustFutureTargetType } from "../../../../target-model/types/index.js";
import { rustProviderOperationFormContractViolation } from "../forms.js";
import { rustProviderOperationFormAcceptsTargetGenericArguments } from "../../../../target-model/operations/form-inputs.js";
import type { FinalizeRustProviderOperationAbiOptions, RustFinalizedOperationAbiFor, RustFinalizedOperationResult, RustFinalizedTargetInput } from "../../../../target-model/records/operations/finalized-operation.js";
import type { RustFinalizedOperationKind } from "../../../../target-model/operations/model.js";
import { insertRustDispatchContextInputs } from "./dispatch-inputs.js";
import { isRustNativeErrorCarriers } from "../../../../target-model/operations/native-error-carriers.js";
import { hasExactKeys, isRecord } from "./validation-records.js";

const finalizationOptionKeys = new Set([
  "operationKind", "form", "sourceReceiver", "sourceArgumentCarriers", "spreadSourceArgumentIndexes",
  "declaredSourceArgumentCarriers", "evaluationOnlySourceArgumentIndexes", "resultCarrier", "dispatchInputs",
  "nativeErrorCarriers", "targetGenericArguments", "resultConversion", "isAsync", "isFallible",
  "returnedFuture", "evaluation", "errorBoundary", "errorCarrier", "isUnsafe",
]);

export function finalizeRustProviderOperationAbi<OperationKind extends RustFinalizedOperationKind>(
  options: FinalizeRustProviderOperationAbiOptions<OperationKind>,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustFinalizedOperationAbiFor<OperationKind> | undefined {
  if (Object.keys(options).some(key => !finalizationOptionKeys.has(key)) ||
    !operationKinds.has(options.operationKind) || !isRustTargetTypeRef(options.resultCarrier) ||
    (options.sourceReceiver !== undefined && (!isRecord(options.sourceReceiver) ||
      (options.sourceReceiver.kind === "compile-time"
        ? !hasExactKeys(options.sourceReceiver, ["kind"])
        : options.sourceReceiver.kind !== "runtime" ||
          !hasExactKeys(options.sourceReceiver, ["kind", "carrier",
            ...(Object.prototype.hasOwnProperty.call(options.sourceReceiver, "declaredCarrier") ? ["declaredCarrier"] : [])]) ||
          !isRustTargetTypeRef(options.sourceReceiver.carrier) ||
          (Object.prototype.hasOwnProperty.call(options.sourceReceiver, "declaredCarrier") &&
            !isRustTargetTypeRef(options.sourceReceiver.declaredCarrier))))) ||
    !isDenseDataArray(options.sourceArgumentCarriers) ||
    options.sourceArgumentCarriers.some((carrier) => !isRustTargetTypeRef(carrier)) ||
    (options.declaredSourceArgumentCarriers !== undefined &&
      (!isDenseDataArray(options.declaredSourceArgumentCarriers) ||
        options.declaredSourceArgumentCarriers.some((carrier) => carrier !== undefined && !isRustTargetTypeRef(carrier)))) ||
    (options.evaluationOnlySourceArgumentIndexes !== undefined &&
      (!isDenseDataArray(options.evaluationOnlySourceArgumentIndexes) ||
        new Set(options.evaluationOnlySourceArgumentIndexes).size !== options.evaluationOnlySourceArgumentIndexes.length ||
        options.evaluationOnlySourceArgumentIndexes.some((index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= options.sourceArgumentCarriers.length))) ||
    (options.targetGenericArguments !== undefined &&
      (!isDenseDataArray(options.targetGenericArguments) || options.targetGenericArguments.length === 0 ||
        options.targetGenericArguments.some((argument) =>
          !isRustTargetGenericArgument(argument)) ||
        !rustProviderOperationFormAcceptsTargetGenericArguments(options.form))) ||
    typeof options.isAsync !== "boolean" || typeof options.isFallible !== "boolean" ||
    (Object.prototype.hasOwnProperty.call(options, "nativeErrorCarriers") && (!options.isFallible || options.errorBoundary !== "source-program" ||
      !isRustNativeErrorCarriers(options.nativeErrorCarriers))) ||
    (options.returnedFuture !== undefined && (
      options.isAsync || options.isFallible ||
      rustFutureOutputCarrier(options.resultCarrier) === undefined ||
      (options.returnedFuture.awaiting !== "infallible" &&
        options.returnedFuture.awaiting !== "fallible") ||
      (options.returnedFuture.awaiting === "infallible"
        ? options.returnedFuture.errorBoundary !== "none" ||
          options.returnedFuture.errorCarrier !== undefined
        : !isRustAwaitedErrorBoundary(options.returnedFuture.errorBoundary) ||
          (options.returnedFuture.errorBoundary === "provider-native"
            ? !isRustTargetTypeRef(options.returnedFuture.errorCarrier)
            : options.returnedFuture.errorCarrier !== undefined)))) ||
    (options.evaluation !== undefined && options.evaluation !== "pure") ||
    (options.isFallible && !isRustFallibleErrorBoundary(options.errorBoundary)) ||
    (!options.isFallible && options.errorBoundary !== undefined) ||
    (options.errorBoundary === "provider-native"
      ? !isRustTargetTypeRef(options.errorCarrier)
      : options.errorCarrier !== undefined) ||
    (options.isUnsafe !== undefined && typeof options.isUnsafe !== "boolean")) {
    return undefined;
  }
  const evaluationOnlyIndexes = new Set(options.evaluationOnlySourceArgumentIndexes ?? []);
  if (options.spreadSourceArgumentIndexes !== undefined &&
    !isDenseDataArray(options.spreadSourceArgumentIndexes)) return undefined;
  const spreadIndexes = new Set(options.spreadSourceArgumentIndexes ?? []);
  const sequenceForm = rustRestSequenceForm(options.form);
  if (options.spreadSourceArgumentIndexes !== undefined &&
    (spreadIndexes.size !== options.spreadSourceArgumentIndexes.length ||
      sequenceForm === undefined ||
      options.spreadSourceArgumentIndexes.some(index => !Number.isSafeInteger(index) ||
        index < sequenceForm.leadingArguments.length ||
        index >= options.sourceArgumentCarriers.length || evaluationOnlyIndexes.has(index)))) return undefined;
  const runtimeSourceIndexes = options.sourceArgumentCarriers
    .map((_carrier, index) => index)
    .filter((index) => !evaluationOnlyIndexes.has(index));
  if (rustProviderOperationFormContractViolation(
    options.operationKind,
    options.form,
    options.sourceArgumentCarriers.length,
    runtimeSourceIndexes, definitions,
  ) !== undefined) {
    return undefined;
  }
  if (!declaredCarriersMatch(
    options.sourceArgumentCarriers,
    runtimeSourceIndexes,
    options.declaredSourceArgumentCarriers,
    options.form,
  )) {
    return undefined;
  }
  const sourceReceiver = options.sourceReceiver;
  const input = createInputFactory(sourceReceiver?.kind === "runtime" ? sourceReceiver.carrier : undefined,
    options.sourceArgumentCarriers, spreadIndexes,
    definitions, sourceReceiver?.kind === "runtime" ? sourceReceiver.declaredCarrier : undefined);
  const sourceMapping = finalizeTargetInputs(
    options.operationKind,
    options.form,
    input,
    options.sourceArgumentCarriers.length, definitions,
  );
  const dispatchInputs = options.dispatchInputs === undefined ? [] : options.dispatchInputs;
  const mapping = sourceMapping === undefined ? undefined
    : insertRustDispatchContextInputs(sourceMapping, dispatchInputs, options.form);
  if (mapping === undefined) {
    return undefined;
  }
  if (options.evaluation === "pure" && (
    dispatchInputs.length > 0 ||
    options.operationKind === "constructor" ||
    options.operationKind === "property-set" ||
    options.operationKind === "index-set" ||
    (mapping.targetReceiver.kind === "input" &&
      rustFinalizedTargetInputMayMutateSource(mapping.targetReceiver.input)) ||
    mapping.targetArguments.some(rustFinalizedTargetInputMayMutateSource)
  )) {
    return undefined;
  }
  const sourceArguments = finalizeSourceArguments(
    options.operationKind,
    options.sourceArgumentCarriers,
    mapping,
    options.evaluationOnlySourceArgumentIndexes,
    spreadIndexes,
  );
  if (sourceArguments === undefined) {
    return undefined;
  }
  const resultConversion = finalizeValueConversion(options.resultConversion, undefined, options.resultCarrier, definitions);
  if (resultConversion === undefined) {
    return undefined;
  }
  const result: RustFinalizedOperationResult = options.isAsync
    ? {
        kind: "async",
        futureCarrier: rustFutureTargetType(options.resultCarrier),
        awaitedRawCarrier: resultConversion.sourceCarrier,
        awaitedConversion: resultConversion,
        awaitedCarrier: options.resultCarrier,
      }
    : {
        kind: "sync",
        rawCarrier: resultConversion.sourceCarrier,
        conversion: resultConversion,
        carrier: options.resultCarrier,
      };
  const abi: RustFinalizedOperationAbiFor<OperationKind> = {
    operationKind: options.operationKind,
    target: options.form,
    sourceReceiver: sourceReceiver === undefined
      ? { kind: "none" }
      : sourceReceiver.kind === "compile-time" ? { kind: "compile-time" } : {
          kind: "receiver",
          carrier: sourceReceiver.carrier,
          declaredCarrier: sourceReceiver.declaredCarrier ?? sourceReceiver.carrier,
          disposition: mappingUsesSourceReceiver(mapping.targetReceiver, mapping.targetArguments)
            ? "runtime"
            : "evaluation-only",
        },
    sourceArguments,
    targetReceiver: mapping.targetReceiver,
    targetArguments: mapping.targetArguments,
    dispatchInputs,
    targetGenericArguments: options.targetGenericArguments ?? [],
    result,
    effects: {
      evaluation: options.evaluation === "pure" ? "pure" : "observable",
      invocation: options.isFallible && !options.isAsync ? "fallible" : "infallible",
      awaiting: options.returnedFuture?.awaiting ?? (options.isAsync
        ? options.isFallible ? "fallible" : "infallible"
        : "not-applicable"),
      errorBoundary: options.returnedFuture?.errorBoundary ??
        (options.isFallible && isRustFallibleErrorBoundary(options.errorBoundary)
          ? options.errorBoundary
          : "none"),
      ...((options.returnedFuture?.errorBoundary === "provider-native" &&
          options.returnedFuture.errorCarrier !== undefined)
        ? { errorCarrier: options.returnedFuture.errorCarrier }
        : options.errorBoundary === "provider-native" && options.errorCarrier !== undefined
          ? { errorCarrier: options.errorCarrier }
          : {}),
      safety: options.isUnsafe ? "requires-unsafe" : "safe",
      ...(options.nativeErrorCarriers === undefined ? {} : { nativeErrorCarriers: options.nativeErrorCarriers }),
    },
  };
  return validateRustFinalizedOperationAbi(abi, definitions) ? snapshotClosedMetadata(abi) : undefined;
}

function mappingUsesSourceReceiver(
  receiver: RustFinalizedOperationAbiFor<RustFinalizedOperationKind>["targetReceiver"],
  arguments_: readonly RustFinalizedTargetInput[],
): boolean {
  const usesReceiver = (input: RustFinalizedTargetInput): boolean => {
    if (input.source.kind === "receiver") {
      return true;
    }
    if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      return input.elements.some(usesReceiver);
    }
    if (isRustFinalizedTaggedArrayInput(input)) {
      return input.elements.some((element) => usesReceiver(element.input));
    }
    return false;
  };
  return receiver.kind === "input" && usesReceiver(receiver.input) ||
    arguments_.some(usesReceiver);
}
