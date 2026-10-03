import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import {
  carrierAfterMode,
  finalizedConversionIsValid,
  isRustFinalizedArrayInput,
  isRustFinalizedConstantInput,
  isRustFinalizedSliceInput,
  isRustFinalizedTaggedArrayInput,
  rustFinalizedTargetInputMayMutateSource,
} from "./conversions.js";
import { closedMetadataEquals, isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { createInputFactory, finalizeTargetInputs } from "./inputs.js";
import { rustRestSequenceForm } from "../../../target-model/operations/rest-assembly.js";
import { isRustErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import {
  isRustTargetGenericArgument,
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../../target-model/types/equality.js";
import { rustFutureOutputCarrier, rustFutureTargetType, rustSliceRefTargetType } from "../../../target-model/types/index.js";
import { rustProviderOperationFormAcceptsTargetGenericArguments, rustProviderOperationFormContractViolation } from "../../../policy/operations/forms.js";
import type { RustFinalizedOperationAbi, RustFinalizedOperationResult, RustFinalizedSourceArgument, RustFinalizedSourceArgumentRole, RustFinalizedSourceInput, RustFinalizedTargetInput } from "./model.js";
import type { RustProviderConstantArgument } from "../keys.js";
import { rustLengthEmptinessContractIsValid } from "../../../target-model/operations/length-emptiness.js";
import { isFinalizedConversion } from "./conversion-shape.js";
import { hasExactKeys, isRecord } from "./validation-records.js";

export function validateRustFinalizedOperationAbi(candidate: unknown, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): candidate is RustFinalizedOperationAbi {
  if (!isClosedMetadata(candidate) || !isRustFinalizedOperationAbiShape(candidate)) {
    return false;
  }
  const abi = candidate;
  if (abi.target.form === "receiver-method" && abi.target.emptyTestMethod !== undefined && (
    abi.result.kind !== "sync" || abi.sourceReceiver.kind !== "receiver" ||
    !rustLengthEmptinessContractIsValid({ target: abi.target, operationKind: abi.operationKind,
      resultCarrier: abi.result.carrier, sourceArgumentCount: abi.sourceArguments.length,
      isFallible: abi.effects.invocation !== "infallible", isAsync: abi.effects.awaiting !== "not-applicable",
      hasResultConversion: abi.result.conversion.kind !== "identity", evaluation: abi.effects.evaluation })
  )) return false;
  if (abi.target.form === "numeric-cast" && (
    abi.result.kind !== "sync" || abi.result.rawCarrier.kind !== "source-primitive" ||
    abi.result.rawCarrier.name !== abi.target.target ||
    abi.effects.invocation !== "infallible" || abi.effects.awaiting !== "not-applicable" ||
    abi.effects.errorBoundary !== "none" || abi.effects.safety !== "safe"
  )) {
    return false;
  }
  if (rustProviderOperationFormContractViolation(
    abi.operationKind,
    abi.target,
    abi.sourceArguments.length,
    abi.sourceArguments.filter((argument) => argument.disposition === "runtime").map((argument) => argument.sourceIndex), definitions,
  ) !== undefined ||
    (abi.targetGenericArguments.length > 0 &&
      !rustProviderOperationFormAcceptsTargetGenericArguments(abi.target)) ||
    (abi.effects.evaluation !== "observable" && abi.effects.evaluation !== "pure") ||
    (abi.effects.invocation !== "infallible" && abi.effects.invocation !== "fallible") ||
    (abi.effects.awaiting !== "not-applicable" && abi.effects.awaiting !== "infallible" && abi.effects.awaiting !== "fallible") ||
    !isRustErrorBoundary(abi.effects.errorBoundary) ||
    (abi.effects.errorBoundary === "provider-native"
      ? !isRustTargetTypeRef(abi.effects.errorCarrier)
      : abi.effects.errorCarrier !== undefined) ||
    (abi.effects.safety !== "safe" && abi.effects.safety !== "requires-unsafe") ||
    (abi.effects.evaluation === "pure" && (
      abi.operationKind === "constructor" || abi.operationKind === "property-set" ||
      abi.operationKind === "index-set" ||
      (abi.targetReceiver.kind === "input" &&
        rustFinalizedTargetInputMayMutateSource(abi.targetReceiver.input)) ||
      abi.targetArguments.some(rustFinalizedTargetInputMayMutateSource)
    ))) {
    return false;
  }
  const sequenceForm = rustRestSequenceForm(abi.target);
  if (abi.sourceArguments.some((argument, index) => {
    const expectedRole: RustFinalizedSourceArgumentRole = argument.disposition === "evaluation-only"
      ? "evaluation-only"
      : (abi.operationKind === "indexer" || abi.operationKind === "index-set") && index === 0
        ? "index"
        : "parameter";
    return argument.sourceIndex !== index ||
      (argument.mode !== "value" && argument.mode !== "ref" && argument.mode !== "mut-ref") ||
      (argument.disposition !== "runtime" && argument.disposition !== "evaluation-only") ||
      (argument.form === "spread-sequence" &&
        (argument.disposition !== "runtime" || sequenceForm === undefined ||
          index < sequenceForm.leadingArguments.length)) ||
      argument.role !== expectedRole;
  })) {
    return false;
  }
  const runtimeIndexes = new Set<number>();
  let receiverUsed = false;
  const validateSourceInput = (input: RustFinalizedSourceInput): boolean => {
    if (!finalizedConversionIsValid(input.conversion, definitions) ||
      !rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.sourceCarrier) ||
      !rustTargetTypeRefEquals(input.parameterCarrier, carrierAfterMode(input.conversion.targetCarrier, input.mode))) {
      return false;
    }
    if (input.source.kind === "argument") {
      const argument = abi.sourceArguments[input.source.sourceIndex];
      if (argument === undefined || argument.disposition !== "runtime" ||
        argument.role === "evaluation-only" || argument.mode !== input.mode ||
        !rustTargetTypeRefEquals(argument.carrier, input.sourceCarrier)) {
        return false;
      }
      runtimeIndexes.add(input.source.sourceIndex);
    } else {
      if (abi.sourceReceiver.kind !== "receiver" ||
        abi.sourceReceiver.disposition !== "runtime" ||
        !rustTargetTypeRefEquals(abi.sourceReceiver.carrier, input.sourceCarrier)) {
        return false;
      }
      receiverUsed = true;
    }
    return true;
  };
  if (abi.targetReceiver.kind === "input" && !validateSourceInput(abi.targetReceiver.input)) {
    return false;
  }
  for (const input of abi.targetArguments) {
    if (isRustFinalizedConstantInput(input)) {
      continue;
    }
    if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      if (input.elements.length !== input.source.sourceIndexes.length ||
        !input.elements.every((element, index) =>
          element.source.kind === "argument" &&
          element.source.sourceIndex === input.source.sourceIndexes[index] &&
          validateSourceInput(element))) {
        return false;
      }
      if (input.elements.some((element) =>
        !rustTargetTypeRefEquals(element.parameterCarrier,
          element.source.kind === "argument" &&
            abi.sourceArguments[element.source.sourceIndex]?.form === "spread-sequence"
            ? { kind: "array", element: input.elementCarrier } : input.elementCarrier)) ||
        (isRustFinalizedSliceInput(input) &&
          !rustTargetTypeRefEquals(input.parameterCarrier, rustSliceRefTargetType(input.elementCarrier)))) {
        return false;
      }
      continue;
    }
    if (isRustFinalizedTaggedArrayInput(input)) {
      if (input.elements.length !== input.source.sourceIndexes.length ||
        !input.elements.every((element, index) =>
          element.input.source.kind === "argument" &&
          element.input.source.sourceIndex === input.source.sourceIndexes[index] &&
          typeof element.constructorPath === "string" &&
          validateSourceInput(element.input))) {
        return false;
      }
      continue;
    }
    if (!validateSourceInput(input)) {
      return false;
    }
  }
  if (abi.sourceArguments.some((argument) =>
    argument.disposition === "runtime" && !runtimeIndexes.has(argument.sourceIndex)) ||
    abi.sourceReceiver.kind === "receiver" &&
      (abi.sourceReceiver.disposition === "runtime") !== receiverUsed) {
    return false;
  }
  const sourceReceiverCarrier = abi.sourceReceiver.kind === "receiver"
    ? abi.sourceReceiver.carrier
    : undefined;
  const expectedMapping = finalizeTargetInputs(
    abi.operationKind,
    abi.target,
    createInputFactory(sourceReceiverCarrier, abi.sourceArguments.map((argument) => argument.carrier),
      new Set(abi.sourceArguments.filter(argument => argument.form === "spread-sequence").map(argument => argument.sourceIndex)), definitions),
    abi.sourceArguments.length, definitions,
  );
  if (expectedMapping === undefined ||
    !closedMetadataEquals(expectedMapping.targetReceiver, abi.targetReceiver) ||
    !closedMetadataEquals(expectedMapping.targetArguments, abi.targetArguments)) {
    return false;
  }
  if (abi.result.kind === "sync") {
    const returnedFutureOutput = rustFutureOutputCarrier(abi.result.carrier);
    const effectsValid = abi.effects.awaiting === "not-applicable"
      ? (abi.effects.invocation === "infallible" && abi.effects.errorBoundary === "none") ||
        (abi.effects.invocation === "fallible" && abi.effects.errorBoundary !== "none")
      : abi.effects.invocation === "infallible" && returnedFutureOutput !== undefined &&
        ((abi.effects.awaiting === "infallible" && abi.effects.errorBoundary === "none") ||
          (abi.effects.awaiting === "fallible" && abi.effects.errorBoundary !== "none"));
    return effectsValid &&
      finalizedConversionIsValid(abi.result.conversion, definitions) &&
      rustTargetTypeRefEquals(abi.result.rawCarrier, abi.result.conversion.sourceCarrier) &&
      rustTargetTypeRefEquals(abi.result.carrier, abi.result.conversion.targetCarrier);
  }
  return abi.effects.invocation === "infallible" &&
    (abi.effects.awaiting === "infallible" || abi.effects.awaiting === "fallible") &&
    ((abi.effects.awaiting === "infallible" && abi.effects.errorBoundary === "none") ||
      (abi.effects.awaiting === "fallible" && abi.effects.errorBoundary !== "none")) &&
    finalizedConversionIsValid(abi.result.awaitedConversion, definitions) &&
    rustTargetTypeRefEquals(abi.result.awaitedRawCarrier, abi.result.awaitedConversion.sourceCarrier) &&
    rustTargetTypeRefEquals(abi.result.awaitedCarrier, abi.result.awaitedConversion.targetCarrier) &&
    rustTargetTypeRefEquals(abi.result.futureCarrier, rustFutureTargetType(abi.result.awaitedCarrier));
}

function isRustFinalizedOperationAbiShape(value: unknown): value is RustFinalizedOperationAbi {
  if (!isRecord(value) || !hasExactKeys(value, [
    "operationKind",
    "target",
    "sourceReceiver",
    "sourceArguments",
    "targetReceiver",
    "targetArguments",
    "targetGenericArguments",
    "result",
    "effects",
  ]) || !operationKinds.has(value.operationKind) || !isRecord(value.target) ||
    !Array.isArray(value.sourceArguments) || !Array.isArray(value.targetArguments) ||
    !Array.isArray(value.targetGenericArguments)) {
    return false;
  }
  if (!isSourceReceiver(value.sourceReceiver) ||
    !value.sourceArguments.every(isSourceArgument) ||
    !isTargetReceiver(value.targetReceiver) ||
    !value.targetArguments.every(isTargetInput) ||
    !value.targetGenericArguments.every(isRustTargetGenericArgument) ||
    !isOperationResult(value.result) || !isEffects(value.effects)) {
    return false;
  }
  return true;
}

export const operationKinds = new Set<unknown>(["method", "constructor", "property", "indexer", "property-set", "index-set"]);
const argumentModes = new Set<unknown>(["value", "ref", "mut-ref"]);
const argumentRoles = new Set<unknown>(["parameter", "index", "evaluation-only"]);
const dispositions = new Set<unknown>(["runtime", "compile-time"]);
const argumentDispositions = new Set<unknown>(["runtime", "evaluation-only"]);

function isSourceReceiver(value: unknown): value is RustFinalizedOperationAbi["sourceReceiver"] {
  return isRecord(value) && (value.kind === "none"
    ? hasExactKeys(value, ["kind"])
    : value.kind === "receiver" &&
      hasExactKeys(value, ["kind", "carrier", "disposition"]) &&
      isRustTargetTypeRef(value.carrier) && dispositions.has(value.disposition));
}

function isSourceArgument(value: unknown): value is RustFinalizedSourceArgument {
  return isRecord(value) && hasExactKeys(value, ["sourceIndex", "form", "carrier", "mode", "role", "disposition"]) &&
    (value.form === "value" || value.form === "spread-sequence") &&
    Number.isSafeInteger(value.sourceIndex) && (value.sourceIndex as number) >= 0 &&
    isRustTargetTypeRef(value.carrier) && argumentModes.has(value.mode) && argumentRoles.has(value.role) &&
    argumentDispositions.has(value.disposition);
}

function isTargetReceiver(value: unknown): value is RustFinalizedOperationAbi["targetReceiver"] {
  return isRecord(value) && (value.kind === "none"
    ? hasExactKeys(value, ["kind"])
    : value.kind === "input" && hasExactKeys(value, ["kind", "input"]) && isSourceInput(value.input));
}

function isTargetInput(value: unknown): value is RustFinalizedTargetInput {
  if (!isRecord(value) || !isRecord(value.source)) {
    return false;
  }
  if (value.source.kind === "receiver" || value.source.kind === "argument") {
    return isSourceInput(value);
  }
  if (value.source.kind === "argument-slice") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode", "parameterCarrier"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every(isSourceInput) &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "ref" && isRustTargetTypeRef(value.parameterCarrier);
  }
  if (value.source.kind === "argument-array") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every(isSourceInput) &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "value";
  }
  if (value.source.kind === "argument-tagged-array") {
    return hasExactKeys(value, ["source", "elements", "elementCarrier", "mode"]) &&
      hasExactKeys(value.source, ["kind", "sourceIndexes"]) && Array.isArray(value.source.sourceIndexes) &&
      value.source.sourceIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) &&
      Array.isArray(value.elements) && value.elements.every((element) =>
        isRecord(element) && hasExactKeys(element, ["input", "constructorPath"]) &&
        isSourceInput(element.input) && typeof element.constructorPath === "string") &&
      isRustTargetTypeRef(value.elementCarrier) && value.mode === "value";
  }
  return value.source.kind === "constant" && hasExactKeys(value, ["source"]) &&
    hasExactKeys(value.source, ["kind", "value"]) && isProviderConstant(value.source.value);
}

function isSourceInput(value: unknown): value is RustFinalizedSourceInput {
  if (!isRecord(value) || !hasExactKeys(value, ["source", "sourceCarrier", "conversion", "mode", "parameterCarrier"]) ||
    !isRecord(value.source) || !isRustTargetTypeRef(value.sourceCarrier) || !isFinalizedConversion(value.conversion) ||
    !argumentModes.has(value.mode) || !isRustTargetTypeRef(value.parameterCarrier)) {
    return false;
  }
  return value.source.kind === "receiver"
    ? hasExactKeys(value.source, ["kind"])
    : value.source.kind === "argument" && hasExactKeys(value.source, ["kind", "sourceIndex"]) &&
      Number.isSafeInteger(value.source.sourceIndex) && (value.source.sourceIndex as number) >= 0;
}


function isProviderConstant(value: unknown): value is RustProviderConstantArgument {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case "integer":
      return hasExactKeys(value, ["kind", "value"]) && Number.isSafeInteger(value.value);
    case "float64":
      return hasExactKeys(value, ["kind", "value"]) &&
        typeof value.value === "number" && Number.isFinite(value.value);
    case "string":
      return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "string";
    case "boolean":
      return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "boolean";
    case "none":
      return value.element === undefined ? hasExactKeys(value, ["kind"]) :
        hasExactKeys(value, ["kind", "element"]) && isRustTargetTypeRef(value.element);
    default:
      return false;
  }
}

function isOperationResult(value: unknown): value is RustFinalizedOperationResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "sync") {
    return hasExactKeys(value, ["kind", "rawCarrier", "conversion", "carrier"]) &&
      isRustTargetTypeRef(value.rawCarrier) && isFinalizedConversion(value.conversion) &&
      isRustTargetTypeRef(value.carrier);
  }
  return value.kind === "async" && hasExactKeys(value, [
    "kind", "futureCarrier", "awaitedRawCarrier", "awaitedConversion", "awaitedCarrier",
  ]) && isRustTargetTypeRef(value.futureCarrier) && isRustTargetTypeRef(value.awaitedRawCarrier) &&
    isFinalizedConversion(value.awaitedConversion) && isRustTargetTypeRef(value.awaitedCarrier);
}

function isEffects(value: unknown): value is RustFinalizedOperationAbi["effects"] {
  return isRecord(value) && hasExactKeys(
    value,
    value.errorBoundary === "provider-native"
      ? ["evaluation", "invocation", "awaiting", "errorBoundary", "errorCarrier", "safety"]
      : ["evaluation", "invocation", "awaiting", "errorBoundary", "safety"],
  ) &&
    (value.evaluation === "observable" || value.evaluation === "pure") &&
    (value.invocation === "infallible" || value.invocation === "fallible") &&
    (value.awaiting === "not-applicable" || value.awaiting === "infallible" || value.awaiting === "fallible") &&
    isRustErrorBoundary(value.errorBoundary) &&
    (value.errorCarrier === undefined || isRustTargetTypeRef(value.errorCarrier)) &&
    (value.safety === "safe" || value.safety === "requires-unsafe");
}
