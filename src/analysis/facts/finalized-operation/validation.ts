import { carrierAfterMode, finalizedConversionIsValid, isRustFinalizedArrayInput, isRustFinalizedConstantInput, isRustFinalizedSliceInput, isRustFinalizedTaggedArrayInput } from "./conversions.js";
import { closedMetadataEquals, isClosedMetadata } from "../../../policy/model/closed-data.js";
import { createInputFactory, finalizeTargetInputs } from "./inputs.js";
import { isRustErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import { rustFutureTargetType, rustSliceRefTargetType, rustTargetTypeParameterNames } from "../../../policy/types/target-types.js";
import { rustProviderOperationFormAcceptsTargetTypeArguments, rustProviderOperationFormContractViolation } from "../../../policy/operations/forms.js";
import { rustValueConversionContract } from "../../../policy/conversions/contracts.js";
import type { RustFinalizedOperationAbi, RustFinalizedOperationResult, RustFinalizedSourceArgument, RustFinalizedSourceArgumentRole, RustFinalizedSourceInput, RustFinalizedTargetInput, RustFinalizedValueConversion } from "./model.js";
import type { RustProviderConstantArgument, RustValueConversion } from "../keys.js";

export function validateRustFinalizedOperationAbi(candidate: unknown): candidate is RustFinalizedOperationAbi {
  if (!isClosedMetadata(candidate) || !isRustFinalizedOperationAbiShape(candidate)) {
    return false;
  }
  const abi = candidate;
  if (rustProviderOperationFormContractViolation(
    abi.operationKind,
    abi.target,
    abi.sourceArguments.length,
    abi.sourceArguments.filter((argument) => argument.disposition === "runtime").map((argument) => argument.sourceIndex),
  ) !== undefined ||
    (abi.targetTypeArguments.length > 0 &&
      !rustProviderOperationFormAcceptsTargetTypeArguments(abi.target)) ||
    (abi.effects.invocation !== "infallible" && abi.effects.invocation !== "fallible") ||
    (abi.effects.awaiting !== "not-applicable" && abi.effects.awaiting !== "infallible" && abi.effects.awaiting !== "fallible") ||
    !isRustErrorBoundary(abi.effects.errorBoundary) ||
    (abi.effects.errorBoundary === "provider-native"
      ? !isRustTargetTypeRef(abi.effects.errorCarrier)
      : abi.effects.errorCarrier !== undefined) ||
    (abi.effects.safety !== "safe" && abi.effects.safety !== "requires-unsafe")) {
    return false;
  }
  if (abi.sourceArguments.some((argument, index) => {
    const expectedRole: RustFinalizedSourceArgumentRole = argument.disposition === "compile-time"
      ? "compile-time"
      : (abi.operationKind === "indexer" || abi.operationKind === "index-set") && index === 0
        ? "index"
        : "parameter";
    return argument.sourceIndex !== index ||
      (argument.mode !== "value" && argument.mode !== "ref" && argument.mode !== "mut-ref") ||
      (argument.disposition !== "runtime" && argument.disposition !== "compile-time") ||
      argument.role !== expectedRole;
  })) {
    return false;
  }
  const runtimeIndexes = new Set<number>();
  let receiverUsed = false;
  const validateSourceInput = (input: RustFinalizedSourceInput): boolean => {
    if (!finalizedConversionIsValid(input.conversion) ||
      !rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.sourceCarrier) ||
      !rustTargetTypeRefEquals(input.parameterCarrier, carrierAfterMode(input.conversion.targetCarrier, input.mode))) {
      return false;
    }
    if (input.source.kind === "argument") {
      const argument = abi.sourceArguments[input.source.sourceIndex];
      if (argument === undefined || argument.disposition !== "runtime" ||
        argument.role === "compile-time" || argument.mode !== input.mode ||
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
        !rustTargetTypeRefEquals(element.parameterCarrier, input.elementCarrier)) ||
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
    createInputFactory(sourceReceiverCarrier, abi.sourceArguments.map((argument) => argument.carrier)),
    abi.sourceArguments.length,
  );
  if (expectedMapping === undefined ||
    !closedMetadataEquals(expectedMapping.targetReceiver, abi.targetReceiver) ||
    !closedMetadataEquals(expectedMapping.targetArguments, abi.targetArguments)) {
    return false;
  }
  if (abi.result.kind === "sync") {
    return abi.effects.awaiting === "not-applicable" &&
      ((abi.effects.invocation === "infallible" && abi.effects.errorBoundary === "none") ||
        (abi.effects.invocation === "fallible" && abi.effects.errorBoundary !== "none")) &&
      finalizedConversionIsValid(abi.result.conversion) &&
      rustTargetTypeRefEquals(abi.result.rawCarrier, abi.result.conversion.sourceCarrier) &&
      rustTargetTypeRefEquals(abi.result.carrier, abi.result.conversion.targetCarrier);
  }
  return abi.effects.invocation === "infallible" &&
    (abi.effects.awaiting === "infallible" || abi.effects.awaiting === "fallible") &&
    ((abi.effects.awaiting === "infallible" && abi.effects.errorBoundary === "none") ||
      (abi.effects.awaiting === "fallible" && abi.effects.errorBoundary !== "none")) &&
    finalizedConversionIsValid(abi.result.awaitedConversion) &&
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
    "targetTypeArguments",
    "result",
    "effects",
  ]) || !operationKinds.has(value.operationKind) || !isRecord(value.target) ||
    !Array.isArray(value.sourceArguments) || !Array.isArray(value.targetArguments) ||
    !Array.isArray(value.targetTypeArguments)) {
    return false;
  }
  if (!isSourceReceiver(value.sourceReceiver) ||
    !value.sourceArguments.every(isSourceArgument) ||
    !isTargetReceiver(value.targetReceiver) ||
    !value.targetArguments.every(isTargetInput) ||
    !value.targetTypeArguments.every((carrier) =>
      isRustTargetTypeRef(carrier) && rustTargetTypeParameterNames(carrier).length === 0) ||
    !isOperationResult(value.result) || !isEffects(value.effects)) {
    return false;
  }
  return true;
}

export const operationKinds = new Set<unknown>(["method", "constructor", "property", "indexer", "property-set", "index-set"]);
const argumentModes = new Set<unknown>(["value", "ref", "mut-ref"]);
const argumentRoles = new Set<unknown>(["parameter", "index", "compile-time"]);
const dispositions = new Set<unknown>(["runtime", "compile-time"]);

function isSourceReceiver(value: unknown): value is RustFinalizedOperationAbi["sourceReceiver"] {
  return isRecord(value) && (value.kind === "none"
    ? hasExactKeys(value, ["kind"])
    : value.kind === "receiver" &&
      hasExactKeys(value, ["kind", "carrier", "disposition"]) &&
      isRustTargetTypeRef(value.carrier) && dispositions.has(value.disposition));
}

function isSourceArgument(value: unknown): value is RustFinalizedSourceArgument {
  return isRecord(value) && hasExactKeys(value, ["sourceIndex", "carrier", "mode", "role", "disposition"]) &&
    Number.isSafeInteger(value.sourceIndex) && (value.sourceIndex as number) >= 0 &&
    isRustTargetTypeRef(value.carrier) && argumentModes.has(value.mode) && argumentRoles.has(value.role) &&
    dispositions.has(value.disposition);
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

function isFinalizedConversion(value: unknown): value is RustFinalizedValueConversion {
  if (!isRecord(value) || !isRustTargetTypeRef(value.sourceCarrier) || !isRustTargetTypeRef(value.targetCarrier)) {
    return false;
  }
  if (value.kind === "identity") {
    return hasExactKeys(value, ["kind", "sourceCarrier", "targetCarrier", "fallible"]) && value.fallible === false;
  }
  return value.kind === "semantic" && hasExactKeys(value, [
    "kind", "conversion", "sourceCarrier", "targetCarrier", "fallible",
  ]) && isRecord(value.conversion) &&
    ((value.conversion.kind === "semantic-conversion" &&
      hasExactKeys(value.conversion, ["kind", "id"]) && typeof value.conversion.id === "string") ||
    (value.conversion.kind === "numeric-promotion" &&
      hasExactKeys(value.conversion, ["kind", "source", "target"]) &&
      typeof value.conversion.source === "string" && typeof value.conversion.target === "string") ||
    (value.conversion.kind === "raw-pointer-mut-to-const" &&
      hasExactKeys(value.conversion, ["kind", "pointee"]) &&
      isRustTargetTypeRef(value.conversion.pointee)) ||
    (value.conversion.kind === "copy-from-reference" &&
      hasExactKeys(value.conversion, ["kind", "target"]) &&
      isRustTargetTypeRef(value.conversion.target)) ||
    (value.conversion.kind === "source-union-variant" &&
      hasExactKeys(value.conversion, ["kind", "source", "target", "variantName"]) &&
      isRustTargetTypeRef(value.conversion.source) &&
      isRustTargetTypeRef(value.conversion.target) &&
      typeof value.conversion.variantName === "string" &&
      value.conversion.variantName.length > 0) ||
    (value.conversion.kind === "bottom-coercion" &&
      hasExactKeys(value.conversion, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.conversion.source) &&
      isRustTargetTypeRef(value.conversion.target)) ||
    (value.conversion.kind === "option-map" &&
      hasExactKeys(value.conversion, ["kind", "elementConversion"]) &&
      isNonOptionValueConversion(value.conversion.elementConversion))) &&
    rustValueConversionContract(value.conversion as RustValueConversion) !== undefined &&
    typeof value.fallible === "boolean";
}

function isNonOptionValueConversion(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (value.kind === "semantic-conversion" &&
      hasExactKeys(value, ["kind", "id"]) && typeof value.id === "string") ||
    (value.kind === "numeric-promotion" &&
      hasExactKeys(value, ["kind", "source", "target"]) &&
      typeof value.source === "string" && typeof value.target === "string") ||
    (value.kind === "raw-pointer-mut-to-const" &&
      hasExactKeys(value, ["kind", "pointee"]) && isRustTargetTypeRef(value.pointee)) ||
    (value.kind === "copy-from-reference" &&
      hasExactKeys(value, ["kind", "target"]) && isRustTargetTypeRef(value.target)) ||
    (value.kind === "source-union-variant" &&
      hasExactKeys(value, ["kind", "source", "target", "variantName"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      typeof value.variantName === "string" && value.variantName.length > 0) ||
    (value.kind === "bottom-coercion" &&
      hasExactKeys(value, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target));
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
      return hasExactKeys(value, ["kind"]);
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
      ? ["invocation", "awaiting", "errorBoundary", "errorCarrier", "safety"]
      : ["invocation", "awaiting", "errorBoundary", "safety"],
  ) &&
    (value.invocation === "infallible" || value.invocation === "fallible") &&
    (value.awaiting === "not-applicable" || value.awaiting === "infallible" || value.awaiting === "fallible") &&
    isRustErrorBoundary(value.errorBoundary) &&
    (value.errorCarrier === undefined || isRustTargetTypeRef(value.errorCarrier)) &&
    (value.safety === "safe" || value.safety === "requires-unsafe");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
