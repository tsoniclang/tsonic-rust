import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { rustClosureTargetType, rustJsArrayTargetType, rustJsStringTargetType, rustJsValueTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import type { RustCheckedCallSelectionInput } from "../../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { Type } from "@tsonic/tsts";

import type { RustRegExpReplacementCallbackEvidence } from "../../../target-model/records/callables/regexp-callbacks.js";
export function selectedRustRegExpReplacementCallbackEvidence(
  request: RustCheckedCallSelectionInput,
  sourceArgumentIndex: number,
  lane: "native" | "exact",
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustRegExpReplacementCallbackEvidence | undefined {
  const selectedParameter = request.source.sourceSelectedSignatureParameters[sourceArgumentIndex];
  const sourceArgument = request.source.sourceArguments[sourceArgumentIndex];
  const expected = stringCarrier(lane);
  return selectedParameter === undefined || sourceArgument === undefined ||
      !isCanonicalReplacementCallback(selectedParameter.selectedType, expected, context, options)
    ? undefined
    : replacementCallbackEvidence(sourceArgument.type, lane, context, options);
}

function replacementCallbackEvidence(
  sourceType: Type,
  lane: "native" | "exact",
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustRegExpReplacementCallbackEvidence | undefined {
  const callable = context.currentSemantics.types.callable(sourceType);
  const expectedString = stringCarrier(lane);
  const result = callable === undefined
    ? undefined
    : resolveRustTargetTypeRef(callable.result.selectedType, context, options);
  if (callable === undefined || result === undefined ||
    !rustTargetTypeRefEquals(result, expectedString)) {
    return undefined;
  }
  const projections: RustRegExpReplacementCallbackEvidence["projections"][number][] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  for (const [index, parameter] of callable.parameters.entries()) {
    if (parameter.parameterKind === "rest") {
      if (index !== callable.parameters.length - 1 ||
        !isDynamicArray(parameter.type, context)) {
        return undefined;
      }
      projections.push("rest-values");
      parameterCarriers.push(rustJsArrayTargetType(rustJsValueTargetType()));
      continue;
    }
    const carrier = resolveRustTargetTypeRef(parameter.type, context, options);
    if (index === 0 && carrier !== undefined &&
      rustTargetTypeRefEquals(carrier, expectedString)) {
      projections.push(lane === "native" ? "native-string" : "exact-string");
      parameterCarriers.push(expectedString);
      continue;
    }
    if (!isDynamic(parameter.type, context)) {
      return undefined;
    }
    projections.push("value");
    parameterCarriers.push(rustJsValueTargetType());
  }
  return Object.freeze({
    lane,
    sourceCarrier: rustClosureTargetType(parameterCarriers, expectedString),
    projections: Object.freeze(projections),
  });
}

function isCanonicalReplacementCallback(
  type: Type,
  expectedString: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): boolean {
  const callable = context.currentSemantics.types.callable(type);
  const first = callable?.parameters[0];
  const rest = callable?.parameters[1];
  const firstCarrier = first === undefined
    ? undefined
    : resolveRustTargetTypeRef(first.type, context, options);
  const resultCarrier = callable === undefined
    ? undefined
    : resolveRustTargetTypeRef(callable.result.selectedType, context, options);
  return callable !== undefined && callable.parameters.length === 2 &&
    first !== undefined && first.parameterKind !== "rest" &&
    firstCarrier !== undefined && rustTargetTypeRefEquals(firstCarrier, expectedString) &&
    rest !== undefined && rest.parameterKind === "rest" &&
    isDynamicArray(rest.type, context) &&
    resultCarrier !== undefined && rustTargetTypeRefEquals(resultCarrier, expectedString);
}

function stringCarrier(lane: "native" | "exact"): TargetTypeRef {
  return lane === "native" ? rustStringTargetType() : rustJsStringTargetType();
}

function isDynamic(type: Type | undefined, context: RustOperationAnalysisContext): boolean {
  return type !== undefined &&
    (context.currentSemantics.types.isAny(type) ||
      context.currentSemantics.types.isUnknown(type));
}

function isDynamicArray(type: Type | undefined, context: RustOperationAnalysisContext): boolean {
  if (type === undefined || !context.currentSemantics.types.isArrayLike(type)) {
    return false;
  }
  const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type) ??
    context.currentSemantics.types.typeArguments(type);
  return arguments_.length === 1 && isDynamic(arguments_[0], context);
}
