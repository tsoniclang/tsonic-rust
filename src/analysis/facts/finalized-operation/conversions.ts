import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { RustArgumentMode, RustProviderOperationForm, RustValueConversion } from "../keys.js";
import type { RustFinalizedArrayInput, RustFinalizedConstantInput, RustFinalizedSliceInput, RustFinalizedSourceInput, RustFinalizedTaggedArrayInput, RustFinalizedTargetInput, RustFinalizedValueConversion } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function isRustFinalizedSourceInput(input: RustFinalizedTargetInput): input is RustFinalizedSourceInput {
  return input.source.kind === "receiver" || input.source.kind === "argument";
}

export function isRustFinalizedSliceInput(input: RustFinalizedTargetInput): input is RustFinalizedSliceInput {
  return input.source.kind === "argument-slice";
}

export function isRustFinalizedArrayInput(input: RustFinalizedTargetInput): input is RustFinalizedArrayInput {
  return input.source.kind === "argument-array";
}

export function isRustFinalizedTaggedArrayInput(input: RustFinalizedTargetInput): input is RustFinalizedTaggedArrayInput {
  return input.source.kind === "argument-tagged-array";
}

export function isRustFinalizedConstantInput(input: RustFinalizedTargetInput): input is RustFinalizedConstantInput {
  return input.source.kind === "constant";
}

export function sourceInput(
  source: RustFinalizedSourceInput["source"],
  sourceCarrier: TargetTypeRef,
  mode: RustArgumentMode,
  conversion: RustValueConversion | undefined,
): RustFinalizedSourceInput | undefined {
  const finalized = finalizeValueConversion(conversion, sourceCarrier, undefined);
  const parameterCarrier = finalized === undefined ? undefined : carrierAfterMode(finalized.targetCarrier, mode);
  return finalized === undefined || parameterCarrier === undefined ? undefined : {
    source,
    sourceCarrier,
    conversion: finalized,
    mode,
    parameterCarrier,
  };
}

export function finalizeValueConversion(
  conversion: RustValueConversion | undefined,
  sourceCarrier: TargetTypeRef | undefined,
  targetCarrier: TargetTypeRef | undefined,
): RustFinalizedValueConversion | undefined {
  if (conversion === undefined) {
    const carrier = sourceCarrier ?? targetCarrier;
    return carrier === undefined || (sourceCarrier !== undefined && targetCarrier !== undefined &&
      !rustTargetTypeRefEquals(sourceCarrier, targetCarrier))
      ? undefined
      : {
          kind: "identity",
          sourceCarrier: carrier,
          targetCarrier: carrier,
          fallible: false,
        };
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined ||
    (sourceCarrier !== undefined && !rustTargetTypeRefEquals(sourceCarrier, contract.source)) ||
    (targetCarrier !== undefined && !rustTargetTypeRefEquals(targetCarrier, contract.target))) {
    return undefined;
  }
  return {
    kind: "semantic",
    conversion,
    sourceCarrier: contract.source,
    targetCarrier: contract.target,
    fallible: contract.fallible,
  };
}

export function finalizedConversionIsValid(conversion: RustFinalizedValueConversion): boolean {
  if (conversion.kind === "identity") {
    return conversion.fallible === false && rustTargetTypeRefEquals(conversion.sourceCarrier, conversion.targetCarrier);
  }
  const contract = rustValueConversionContract(conversion.conversion);
  return contract !== undefined &&
    rustTargetTypeRefEquals(conversion.sourceCarrier, contract.source) &&
    rustTargetTypeRefEquals(conversion.targetCarrier, contract.target) &&
    conversion.fallible === contract.fallible;
}

export function carrierAfterMode(carrier: TargetTypeRef, mode: RustArgumentMode): TargetTypeRef | undefined {
  if (mode === "value") {
    return carrier;
  }
  return {
    kind: "reference",
    referent: carrier,
    mutable: mode === "mut-ref",
  };
}

export function declaredCarriersMatch(
  source: readonly TargetTypeRef[],
  runtimeSourceIndexes: readonly number[],
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  form: RustProviderOperationForm,
): boolean {
  if (form.form === "call-c-variadic") {
    return declared !== undefined && isDenseDataArray(source) &&
      isDenseDataArray(runtimeSourceIndexes) && isDenseDataArray(declared) &&
      runtimeSourceIndexes.length === source.length &&
      runtimeSourceIndexes.every((sourceIndex, index) => sourceIndex === index) &&
      declared.length === form.fixedArgumentModes.length &&
      source.length >= declared.length &&
      declared.every((carrier, index) => carrier === undefined ||
        rustTargetTypeRefEquals(source[index]!, carrier));
  }
  return declared === undefined || (isDenseDataArray(source) && isDenseDataArray(runtimeSourceIndexes) &&
    isDenseDataArray(declared) && runtimeSourceIndexes.length === declared.length &&
    declared.every((carrier, index) => carrier === undefined ||
      rustTargetTypeRefEquals(source[runtimeSourceIndexes[index]!], carrier)));
}
