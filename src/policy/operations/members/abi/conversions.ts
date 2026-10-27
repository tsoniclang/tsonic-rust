import { emptyRustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { isDenseDataArray } from "../../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustValueConversionContract } from "../../../conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../conversions/selection.js";
import { rustCallableTargetForSourceLifetime } from "../../../conversions/value-carrier-reconciliation.js";
import { isFinalizedConversion } from "./conversion-shape.js";
import type { RustArgumentMode, RustProviderOperationForm, RustValueConversion } from "../../../../target-model/operations/model.js";
import type { RustFinalizedSourceInput, RustFinalizedValueConversion } from "../../../../target-model/records/operations/finalized-operation.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function sourceInput(
  source: RustFinalizedSourceInput["source"],
  sourceCarrier: TargetTypeRef,
  mode: RustArgumentMode,
  conversion: RustValueConversion | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  declaredCarrier: TargetTypeRef = sourceCarrier,
): RustFinalizedSourceInput | undefined {
  const referenceValue = conversion === undefined && mode === "ref" &&
    sourceCarrier.kind === "reference" && !sourceCarrier.mutable &&
    rustTargetTypeRefEquals(sourceCarrier, carrierAfterMode(declaredCarrier, mode));
  const conversionCarrier = referenceValue ? sourceCarrier : declaredCarrier;
  const inputMode = referenceValue ? "value" : mode;
  const selected = rustTargetTypeRefEquals(sourceCarrier, conversionCarrier)
    ? undefined : selectRustSourceValueConversion(sourceCarrier, conversionCarrier, definitions);
  const sourceConversion = finalizeValueConversion(selected, sourceCarrier, conversionCarrier, definitions);
  const targetConversion = finalizeValueConversion(conversion, conversionCarrier, undefined, definitions);
  const finalized = sourceConversion === undefined || targetConversion === undefined
    ? undefined : composeFinalizedValueConversions(sourceConversion, targetConversion);
  const parameterCarrier = finalized === undefined ? undefined : carrierAfterMode(finalized.targetCarrier, inputMode);
  const first = finalized?.kind === "sequence" ? finalized.steps[0] : finalized;
  return finalized === undefined || parameterCarrier === undefined ? undefined : {
    source,
    sourceCarrier,
    conversion: finalized,
    mode: inputMode,
    parameterCarrier,
    sharedConversion: first?.kind === "semantic" && rustValueConversionContract(first.conversion, definitions)?.sourceMode === "ref",
    elementView: parameterCarrier.kind === "reference" && parameterCarrier.referent.kind === "target-named" &&
      parameterCarrier.referent.id === "rust.std.String" ? "str" : "value",
  };
}

export function finalizeValueConversion(
  conversion: RustValueConversion | undefined,
  sourceCarrier: TargetTypeRef | undefined,
  targetCarrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
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
  const contract = rustValueConversionContract(conversion, definitions);
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

export function finalizedConversionIsValid(conversion: RustFinalizedValueConversion, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  if (!isFinalizedConversion(conversion)) return false;
  if (conversion.kind === "sequence") {
    return rustTargetTypeRefEquals(conversion.sourceCarrier, conversion.steps[0]!.sourceCarrier) &&
      rustTargetTypeRefEquals(conversion.targetCarrier, conversion.steps[conversion.steps.length - 1]!.targetCarrier) &&
      conversion.fallible === conversion.steps.some(step => step.fallible) &&
      conversion.steps.every((step, index) => finalizedConversionIsValid(step, definitions) &&
        (index === 0 || rustTargetTypeRefEquals(conversion.steps[index - 1]!.targetCarrier, step.sourceCarrier)));
  }
  if (conversion.kind === "identity") {
    return conversion.fallible === false && rustTargetTypeRefEquals(conversion.sourceCarrier, conversion.targetCarrier);
  }
  const contract = rustValueConversionContract(conversion.conversion, definitions);
  return contract !== undefined &&
    rustTargetTypeRefEquals(conversion.sourceCarrier, contract.source) &&
    rustTargetTypeRefEquals(conversion.targetCarrier, contract.target) &&
    conversion.fallible === contract.fallible;
}

function composeFinalizedValueConversions(
  source: RustFinalizedValueConversion,
  target: RustFinalizedValueConversion,
): RustFinalizedValueConversion | undefined {
  if (!rustTargetTypeRefEquals(source.targetCarrier, target.sourceCarrier)) return undefined;
  if (source.kind === "identity") return target;
  if (target.kind === "identity") return source;
  return {
    kind: "sequence",
    steps: Object.freeze([
      ...(source.kind === "sequence" ? source.steps : [source]),
      ...(target.kind === "sequence" ? target.steps : [target]),
    ]),
    sourceCarrier: source.sourceCarrier,
    targetCarrier: target.targetCarrier,
    fallible: source.fallible || target.fallible,
  };
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
      declared.every((carrier, index) => carrier === undefined || declaredCarrierMatches(source[index]!, carrier));
  }
  return declared === undefined || (isDenseDataArray(source) && isDenseDataArray(runtimeSourceIndexes) &&
    isDenseDataArray(declared) && runtimeSourceIndexes.length === declared.length &&
    declared.every((carrier, index) => carrier === undefined ||
      declaredCarrierMatches(source[runtimeSourceIndexes[index]!]!, carrier)));
}

// A declared callable parameter whose lifetime is still a placeholder takes the concrete lifetime of the value passed.
function declaredCarrierMatches(source: TargetTypeRef, declared: TargetTypeRef): boolean {
  return rustTargetTypeRefEquals(source, rustCallableTargetForSourceLifetime(source, declared));
}
