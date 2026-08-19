import { createInputFactory, finalizeSourceArguments, finalizeTargetInputs } from "./inputs.js";
import { declaredCarriersMatch, finalizeValueConversion } from "./conversions.js";
import { isDenseDataArray } from "../../../policy/model/closed-data.js";
import { isRustFallibleErrorBoundary } from "../../../policy/operations/error-boundary.js";
import { isRustTargetTypeRef } from "../../../policy/types/equality.js";
import { operationKinds, validateRustFinalizedOperationAbi } from "./validation.js";
import { rustFutureTargetType, rustTargetTypeParameterNames } from "../../../policy/types/target-types.js";
import { rustProviderOperationFormAcceptsTargetTypeArguments, rustProviderOperationFormContractViolation } from "../../../policy/operations/forms.js";
import type { FinalizeRustProviderOperationAbiOptions, RustFinalizedOperationAbiFor, RustFinalizedOperationResult } from "./model.js";
import type { RustFinalizedOperationKind } from "../../../policy/operations/model.js";

export function finalizeRustProviderOperationAbi<OperationKind extends RustFinalizedOperationKind>(
  options: FinalizeRustProviderOperationAbiOptions<OperationKind>,
): RustFinalizedOperationAbiFor<OperationKind> | undefined {
  if (!operationKinds.has(options.operationKind) || !isRustTargetTypeRef(options.resultCarrier) ||
    (options.sourceReceiverCarrier !== undefined && !isRustTargetTypeRef(options.sourceReceiverCarrier)) ||
    !isDenseDataArray(options.sourceArgumentCarriers) ||
    options.sourceArgumentCarriers.some((carrier) => !isRustTargetTypeRef(carrier)) ||
    (options.declaredSourceArgumentCarriers !== undefined &&
      (!isDenseDataArray(options.declaredSourceArgumentCarriers) ||
        options.declaredSourceArgumentCarriers.some((carrier) => carrier !== undefined && !isRustTargetTypeRef(carrier)))) ||
    (options.compileTimeSourceArgumentIndexes !== undefined &&
      (!isDenseDataArray(options.compileTimeSourceArgumentIndexes) ||
        new Set(options.compileTimeSourceArgumentIndexes).size !== options.compileTimeSourceArgumentIndexes.length ||
        options.compileTimeSourceArgumentIndexes.some((index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= options.sourceArgumentCarriers.length))) ||
    (options.targetTypeArguments !== undefined &&
      (!isDenseDataArray(options.targetTypeArguments) || options.targetTypeArguments.length === 0 ||
        options.targetTypeArguments.some((carrier) =>
          !isRustTargetTypeRef(carrier) || rustTargetTypeParameterNames(carrier).length !== 0) ||
        !rustProviderOperationFormAcceptsTargetTypeArguments(options.form))) ||
    typeof options.isAsync !== "boolean" || typeof options.isFallible !== "boolean" ||
    (options.isFallible && !isRustFallibleErrorBoundary(options.errorBoundary)) ||
    (!options.isFallible && options.errorBoundary !== undefined) ||
    (options.isUnsafe !== undefined && typeof options.isUnsafe !== "boolean")) {
    return undefined;
  }
  const compileTimeIndexes = new Set(options.compileTimeSourceArgumentIndexes ?? []);
  const runtimeSourceIndexes = options.sourceArgumentCarriers
    .map((_carrier, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  if (rustProviderOperationFormContractViolation(
    options.operationKind,
    options.form,
    options.sourceArgumentCarriers.length,
    runtimeSourceIndexes,
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
  const input = createInputFactory(options.sourceReceiverCarrier, options.sourceArgumentCarriers);
  const mapping = finalizeTargetInputs(
    options.operationKind,
    options.form,
    input,
    options.sourceArgumentCarriers.length,
  );
  if (mapping === undefined) {
    return undefined;
  }
  const sourceArguments = finalizeSourceArguments(
    options.operationKind,
    options.sourceArgumentCarriers,
    mapping,
    options.compileTimeSourceArgumentIndexes,
  );
  if (sourceArguments === undefined) {
    return undefined;
  }
  const resultConversion = finalizeValueConversion(options.resultConversion, undefined, options.resultCarrier);
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
    sourceReceiver: options.sourceReceiverCarrier === undefined
      ? { kind: "none" }
      : { kind: "receiver", carrier: options.sourceReceiverCarrier },
    sourceArguments,
    targetReceiver: mapping.targetReceiver,
    targetArguments: mapping.targetArguments,
    targetTypeArguments: options.targetTypeArguments ?? [],
    result,
    effects: {
      invocation: options.isFallible && !options.isAsync ? "fallible" : "infallible",
      awaiting: options.isAsync
        ? options.isFallible ? "fallible" : "infallible"
        : "not-applicable",
      errorBoundary: options.isFallible && isRustFallibleErrorBoundary(options.errorBoundary)
        ? options.errorBoundary
        : "none",
      safety: options.isUnsafe ? "requires-unsafe" : "safe",
    },
  };
  return validateRustFinalizedOperationAbi(abi) ? abi : undefined;
}
