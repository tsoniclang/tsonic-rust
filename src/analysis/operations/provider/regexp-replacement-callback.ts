import {
  rustClosureTargetType,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustJsValueTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import type {
  RustCheckedCallSelectionInput,
  RustOperationPolicyContext,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type {
  RustProviderOperationForm,
  RustValueConversion,
} from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { Type } from "@tsonic/tsts";

export interface RustRegExpReplacementCallbackEvidence {
  readonly lane: "native" | "exact";
  readonly sourceCarrier: TargetTypeRef;
  readonly projections: readonly (
    | "native-string"
    | "exact-string"
    | "value"
    | "rest-values"
  )[];
}

export interface RustRegExpReplacementCallbackContract extends RustRegExpReplacementCallbackEvidence {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export function selectedRustRegExpReplacementCallbackEvidence(
  request: RustCheckedCallSelectionInput,
  sourceArgumentIndex: number,
  lane: "native" | "exact",
  context: RustOperationPolicyContext,
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

export function finalizeRustRegExpReplacementCallbackContract(
  evidence: RustRegExpReplacementCallbackEvidence,
  sourceCarrier: TargetTypeRef,
): RustRegExpReplacementCallbackContract | undefined {
  if (!rustTargetTypeRefEquals(evidence.sourceCarrier, sourceCarrier)) {
    return undefined;
  }
  return Object.freeze({
    ...evidence,
    sourceCarrier,
    targetCarrier: rustClosureTargetType({
      callTrait: "fn-mut",
      parameters: [rustJsArrayTargetType(rustJsValueTargetType())],
      result: stringCarrier(evidence.lane),
    }),
  });
}

export function applyRustRegExpReplacementCallbackConversion(
  form: RustProviderOperationForm,
  sourceArgumentIndex: number,
  sourceArgumentCount: number,
  contract: RustRegExpReplacementCallbackContract,
  sourceFallible: boolean,
): RustProviderOperationForm | undefined {
  if (form.form !== "call" && form.form !== "free-call" &&
    form.form !== "receiver-method" && form.form !== "arg-receiver-method" &&
    form.form !== "arg-structural-method") {
    return undefined;
  }
  const existing = form.argConversions;
  if (sourceArgumentIndex < 0 || sourceArgumentIndex >= sourceArgumentCount ||
    (existing !== undefined && existing.length !== sourceArgumentCount) ||
    existing?.[sourceArgumentIndex] !== undefined ||
    ((form.form === "arg-receiver-method" || form.form === "arg-structural-method") &&
      sourceArgumentIndex === 0)) {
    return undefined;
  }
  const conversions = existing === undefined
    ? Array.from(
        { length: sourceArgumentCount },
        (): RustValueConversion | undefined => undefined,
      )
    : [...existing];
  conversions[sourceArgumentIndex] = Object.freeze({
    kind: "js-argument-vector-callback",
    lane: contract.lane,
    source: contract.sourceCarrier,
    target: contract.targetCarrier,
    projections: contract.projections,
    sourceFallible,
  });
  return Object.freeze({ ...form, argConversions: Object.freeze(conversions) });
}

function replacementCallbackEvidence(
  sourceType: Type,
  lane: "native" | "exact",
  context: RustOperationPolicyContext,
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
    sourceCarrier: rustClosureTargetType({
      callTrait: "fn-mut",
      parameters: parameterCarriers,
      result: expectedString,
    }),
    projections: Object.freeze(projections),
  });
}

function isCanonicalReplacementCallback(
  type: Type,
  expectedString: TargetTypeRef,
  context: RustOperationPolicyContext,
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

function isDynamic(type: Type | undefined, context: RustOperationPolicyContext): boolean {
  return type !== undefined &&
    (context.currentSemantics.types.isAny(type) ||
      context.currentSemantics.types.isUnknown(type));
}

function isDynamicArray(type: Type | undefined, context: RustOperationPolicyContext): boolean {
  if (type === undefined || !context.currentSemantics.types.isArrayLike(type)) {
    return false;
  }
  const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type) ??
    context.currentSemantics.types.typeArguments(type);
  return arguments_.length === 1 && isDynamic(arguments_[0], context);
}
