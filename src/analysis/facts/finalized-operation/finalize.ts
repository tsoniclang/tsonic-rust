import { createInputFactory, finalizeSourceArguments, finalizeTargetInputs } from "./inputs.js";
import {
  finalizeValueConversion,
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedTaggedArrayInput,
  rustFinalizedTargetInputMayMutateSource,
} from "./conversions.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { isRustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { operationKinds, validateRustFinalizedOperationAbi } from "./validation.js";
import { rustFutureTargetType, rustTargetTypeParameterNames } from "../../../target-model/types/index.js";
import { rustProviderOperationFormAcceptsTargetTypeArguments, rustProviderOperationFormContractViolation } from "../../../policy/operations/forms.js";
import type { FinalizeRustProviderOperationAbiOptions, RustFinalizedOperationAbiFor, RustFinalizedOperationResult, RustFinalizedTargetInput } from "./model.js";
import type { RustFinalizedOperationKind } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function finalizeRustProviderOperationAbi<OperationKind extends RustFinalizedOperationKind>(
  options: FinalizeRustProviderOperationAbiOptions<OperationKind>,
): RustFinalizedOperationAbiFor<OperationKind> | undefined {
  if (!operationKinds.has(options.operationKind) || !isRustTargetTypeRef(options.resultCarrier) ||
    (options.sourceReceiverCarrier !== undefined && !isRustTargetTypeRef(options.sourceReceiverCarrier)) ||
    !isDenseDataArray(options.sourceArgumentCarriers) ||
    options.sourceArgumentCarriers.some((carrier) => !isRustTargetTypeRef(carrier)) ||
    (options.selectedParameterCarriers !== undefined &&
      (!isDenseDataArray(options.selectedParameterCarriers) ||
        options.selectedParameterCarriers.some((carrier) => !isRustTargetTypeRef(carrier)))) ||
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
    (options.evaluation !== undefined && options.evaluation !== "pure") ||
    (options.isFallible && !isRustFallibleErrorBoundary(options.errorBoundary)) ||
    (!options.isFallible && options.errorBoundary !== undefined) ||
    (options.errorBoundary === "provider-native"
      ? !isRustTargetTypeRef(options.errorCarrier)
      : options.errorCarrier !== undefined) ||
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
  if (options.selectedParameterCarriers !== undefined &&
    options.selectedParameterCarriers.length !== runtimeSourceIndexes.length) {
    return undefined;
  }
  const selectedParameterCarriers = options.sourceArgumentCarriers.map(
    (carrier, sourceIndex): TargetTypeRef | undefined => {
      const runtimeIndex = runtimeSourceIndexes.indexOf(sourceIndex);
      return runtimeIndex < 0
        ? undefined
        : options.selectedParameterCarriers?.[runtimeIndex] ?? carrier;
    },
  );
  const input = createInputFactory(
    options.sourceReceiverCarrier,
    options.sourceArgumentCarriers,
    selectedParameterCarriers,
  );
  const mapping = finalizeTargetInputs(
    options.operationKind,
    options.form,
    input,
    options.sourceArgumentCarriers.length,
  );
  if (mapping === undefined) {
    return undefined;
  }
  if (options.evaluation === "pure" && (
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
    selectedParameterCarriers,
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
        futureCarrier: rustFutureTargetType(resultConversion.sourceCarrier),
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
      : {
          kind: "receiver",
          carrier: options.sourceReceiverCarrier,
          disposition: mappingUsesSourceReceiver(mapping.targetReceiver, mapping.targetArguments)
            ? "runtime"
            : "compile-time",
        },
    sourceArguments,
    targetReceiver: mapping.targetReceiver,
    targetArguments: mapping.targetArguments,
    targetTypeArguments: options.targetTypeArguments ?? [],
    result,
    effects: {
      evaluation: options.evaluation === "pure" ? "pure" : "observable",
      invocation: options.isFallible && !options.isAsync ? "fallible" : "infallible",
      awaiting: options.isAsync
        ? options.isFallible ? "fallible" : "infallible"
        : "not-applicable",
      errorBoundary: options.isFallible && isRustFallibleErrorBoundary(options.errorBoundary)
        ? options.errorBoundary
        : "none",
      ...(options.errorBoundary === "provider-native" && options.errorCarrier !== undefined
        ? { errorCarrier: options.errorCarrier }
        : {}),
      safety: options.isUnsafe ? "requires-unsafe" : "safe",
    },
  };
  return validateRustFinalizedOperationAbi(abi) ? abi : undefined;
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
