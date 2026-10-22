import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustAbsenceCarrier, isRustUnitCarrier, rustCallableProtocol, rustCallableInputProtocol, rustClosureProtocol, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { rustValueConversionContract } from "./contracts.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustCallableInputMatches } from "./callable-input.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";

import type { RustCallableValueConversion, RustCallableConversion } from "../../target-model/conversions/callable.js";
export function rustCallableValueConversionMatches(
  conversion: RustCallableValueConversion,
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (typeof conversion !== "object" || conversion === null || !isClosedMetadata(conversion)) return false;
  if (conversion.kind === "identity") return hasExactObjectKeys(conversion, ["kind"]) && rustTargetTypeRefEquals(source, target);
  if (conversion.kind === "borrow") return hasExactObjectKeys(conversion, ["kind"]) &&
    target.kind === "reference" && target.mutable === false && target.lifetime === undefined &&
    rustTargetTypeRefEquals(source, target.referent);
  if (conversion.kind === "discard") return hasExactObjectKeys(conversion, ["kind"]) && isRustUnitCarrier(target);
  if (conversion.kind === "absence") return hasExactObjectKeys(conversion, ["kind"]) && (isRustUnitCarrier(source) || isRustAbsenceCarrier(source)) &&
    (rustOptionElementCarrier(target) !== undefined || rustOptionalStorageValue(target) !== undefined);
  if (conversion.kind !== "value" || !hasExactObjectKeys(conversion, ["kind", "conversion"]) ||
    typeof conversion.conversion !== "object" || conversion.conversion === null) return false;
  if (conversion.conversion.kind === "callable-adapter") {
    return rustCallableConversionMatches(conversion.conversion, source, target, definitions);
  }
  const contract = rustValueConversionContract(conversion.conversion, definitions);
  return contract !== undefined && contract.sourceMode === "value" &&
    rustTargetTypeRefEquals(contract.source, source) && rustTargetTypeRefEquals(contract.target, target);
}

// A frame callable's entry returns its component's program error (see rustNativeCallablePhysicalSource).
function callableSourceError(source: TargetTypeRef, protocol: { readonly error?: TargetTypeRef }): TargetTypeRef | undefined {
  return "error" in protocol ? protocol.error : rustFrameCallableValue(source) !== undefined ? rustProgramErrorTargetType() : undefined;
}

export function rustCallableConversionMatches(
  conversion: RustCallableConversion,
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (!isClosedMetadata(conversion) || !(hasExactObjectKeys(conversion, ["kind", "source", "target", "parameters", "result"]) ||
    hasExactObjectKeys(conversion, ["kind", "source", "target", "parameters", "result", "error"])) ||
    conversion.kind !== "callable-adapter" || !isDenseDataArray(conversion.parameters) ||
    !isRustTargetTypeRef(source) || !isRustTargetTypeRef(target) || rustCallableInputMatches(source, target) ||
    rustNativeRepresentationMatches(source, target) ||
    rustCallableInputProtocol(source) !== undefined && rustCallableInputProtocol(target) === undefined) return false;
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = callableConversionTarget(target);
  const sourceError = sourceCallable === undefined ? undefined : callableSourceError(source, sourceCallable);
  return rustTargetTypeRefEquals(conversion.source, source) && rustTargetTypeRefEquals(conversion.target, target) &&
    sourceCallable !== undefined && targetCallable !== undefined &&
    (conversion.error === undefined
      ? !("error" in targetCallable) || rustTargetTypeRefEquals(sourceError, targetCallable.error)
      : "error" in targetCallable && targetCallable.error !== undefined && sourceError !== undefined &&
        rustCallableErrorConversionMatches(conversion.error, sourceError, targetCallable.error, definitions)) &&
    sourceCallable.parameters.length <= targetCallable.parameters.length &&
    conversion.parameters.length === sourceCallable.parameters.length &&
    conversion.parameters.every((parameter, index) =>
      rustCallableValueConversionMatches(parameter, targetCallable.parameters[index]!, sourceCallable.parameters[index]!, definitions) &&
      parameter.kind !== "absence" && parameter.kind !== "discard") &&
    conversion.result.kind !== "borrow" &&
    rustCallableValueConversionMatches(conversion.result, sourceCallable.result, targetCallable.result, definitions);
}

export function selectRustCallableConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  selectValue: (source: TargetTypeRef, target: TargetTypeRef) => RustValueConversion | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustCallableConversion | undefined {
  if (!isRustTargetTypeRef(source) || !isRustTargetTypeRef(target) || rustCallableInputMatches(source, target) ||
    rustNativeRepresentationMatches(source, target) ||
    rustCallableInputProtocol(source) !== undefined && rustCallableInputProtocol(target) === undefined) return undefined;
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = callableConversionTarget(target);
  if (sourceCallable === undefined || targetCallable === undefined ||
    sourceCallable.parameters.length > targetCallable.parameters.length) return undefined;
  // A callable whose error differs from the destination's is adapted only through an exact, infallible error conversion.
  const targetError = "error" in targetCallable ? targetCallable.error : undefined;
  let error: RustValueConversion | undefined;
  const sourceError = callableSourceError(source, sourceCallable);
  if (targetError !== undefined && !rustTargetTypeRefEquals(sourceError, targetError)) {
    error = sourceError === undefined ? undefined : selectValue(sourceError, targetError);
    if (sourceError === undefined || error === undefined ||
      !rustCallableErrorConversionMatches(error, sourceError, targetError, definitions)) return undefined;
  }
  const select = (sourceValue: TargetTypeRef, targetValue: TargetTypeRef): RustCallableValueConversion | undefined => {
    if (rustTargetTypeRefEquals(sourceValue, targetValue)) return { kind: "identity" };
    const conversion = selectRustCallableConversion(sourceValue, targetValue, selectValue, definitions) ??
      selectValue(sourceValue, targetValue);
    return conversion === undefined ? undefined : { kind: "value", conversion };
  };
  const parameters = sourceCallable.parameters.map((parameter, index) => {
    const input = targetCallable.parameters[index]!;
    return parameter.kind === "reference" && parameter.mutable === false && parameter.lifetime === undefined &&
      rustTargetTypeRefEquals(input, parameter.referent)
      ? { kind: "borrow" as const } : select(input, parameter);
  });
  const result: RustCallableValueConversion | undefined =
    (isRustUnitCarrier(sourceCallable.result) || isRustAbsenceCarrier(sourceCallable.result)) &&
      (rustOptionElementCarrier(targetCallable.result) !== undefined || rustOptionalStorageValue(targetCallable.result) !== undefined)
      ? { kind: "absence" } : isRustUnitCarrier(targetCallable.result) && !isRustUnitCarrier(sourceCallable.result)
        ? { kind: "discard" } : select(sourceCallable.result, targetCallable.result);
  if (parameters.some(parameter => parameter === undefined) || result === undefined) return undefined;
  const conversion: RustCallableConversion = { kind: "callable-adapter", source, target,
    parameters: parameters as readonly RustCallableValueConversion[], result, ...(error === undefined ? {} : { error }) };
  return rustCallableConversionMatches(conversion, source, target, definitions) ? snapshotClosedMetadata(conversion) : undefined;
}

function rustCallableErrorConversionMatches(conversion: RustValueConversion, source: TargetTypeRef, target: TargetTypeRef,
  definitions: RustTypeDefinitions): boolean {
  const contract = rustValueConversionContract(conversion, definitions);
  return contract !== undefined && contract.sourceMode === "value" && !contract.fallible && contract.category === "exact" &&
    rustTargetTypeRefEquals(contract.source, source) && rustTargetTypeRefEquals(contract.target, target);
}

function callableConversionTarget(target: TargetTypeRef) {
  const input = rustCallableInputProtocol(target);
  if (input !== undefined) return input;
  return target.kind === "closure" && target.fallible === true
    ? rustClosureProtocol(target) : rustCallableProtocol(target);
}
