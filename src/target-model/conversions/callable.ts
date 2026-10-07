import type { RustValueConversion } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";
import { isRustAbsenceCarrier, isRustUnitCarrier, rustCallableProtocol, rustCallableInputProtocol, rustClosureProtocol, rustOptionElementCarrier } from "../types/index.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../types/equality.js";
import { rustOptionalStorageValue } from "../types/projections.js";
import { rustValueConversionContract } from "./contracts.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { rustCallableInputMatches } from "./callable-input.js";

export type RustCallableValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "value"; readonly conversion: RustValueConversion | RustCallableConversion }
  | { readonly kind: "borrow" }
  | { readonly kind: "absence" }
  | { readonly kind: "discard" };

export interface RustCallableConversion {
  readonly kind: "callable-adapter";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly parameters: readonly RustCallableValueConversion[];
  readonly result: RustCallableValueConversion;
}

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

export function rustCallableConversionMatches(
  conversion: RustCallableConversion,
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  if (!isClosedMetadata(conversion) || !hasExactObjectKeys(conversion, ["kind", "source", "target", "parameters", "result"]) ||
    conversion.kind !== "callable-adapter" || !isDenseDataArray(conversion.parameters) ||
    !isRustTargetTypeRef(source) || !isRustTargetTypeRef(target) || rustCallableInputMatches(source, target) ||
    rustCallableInputProtocol(source) !== undefined && rustCallableInputProtocol(target) === undefined) return false;
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = callableConversionTarget(target);
  return rustTargetTypeRefEquals(conversion.source, source) && rustTargetTypeRefEquals(conversion.target, target) &&
    sourceCallable !== undefined && targetCallable !== undefined &&
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
    rustCallableInputProtocol(source) !== undefined && rustCallableInputProtocol(target) === undefined) return undefined;
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = callableConversionTarget(target);
  if (sourceCallable === undefined || targetCallable === undefined ||
    sourceCallable.parameters.length > targetCallable.parameters.length) return undefined;
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
    parameters: parameters as readonly RustCallableValueConversion[], result };
  return rustCallableConversionMatches(conversion, source, target, definitions) ? snapshotClosedMetadata(conversion) : undefined;
}

function callableConversionTarget(target: TargetTypeRef) {
  const input = rustCallableInputProtocol(target);
  if (input !== undefined) return input;
  return target.kind === "closure" && target.fallible === true
    ? rustClosureProtocol(target) : rustCallableProtocol(target);
}
