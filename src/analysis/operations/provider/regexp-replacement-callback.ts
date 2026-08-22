import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import {
  rustCallableTargetType,
  rustClosureTargetType,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustJsValueTargetType,
} from "../../../target-model/types/index.js";
import type {
  RustCheckedCallSelectionInput,
  RustOperationPolicyContext,
} from "../../../policy/operations/contracts.js";
import type {
  RustProviderOperationForm,
  RustValueConversion,
} from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { Type } from "@tsonic/tsts";

export interface RustRegExpReplacementCallbackContract {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly projections: readonly ("string" | "value" | "rest-values")[];
}

export function selectedRustRegExpReplacementCallbackContract(
  request: RustCheckedCallSelectionInput,
  ownerName: string,
  memberName: string,
  context: RustOperationPolicyContext,
): RustRegExpReplacementCallbackContract | undefined {
  if (!isReplacementOperation(ownerName, memberName)) {
    return undefined;
  }
  const selectedParameter = request.source.sourceSelectedSignatureParameters[1];
  const sourceArgument = request.source.sourceArguments[1];
  return selectedParameter === undefined || sourceArgument === undefined ||
      !isCanonicalReplacementCallback(selectedParameter.selectedType, context)
    ? undefined
    : resolveRustRegExpReplacementCallbackContract(sourceArgument.type, context);
}

export function resolveRustRegExpReplacementCallbackContract(
  sourceType: Type,
  context: RustOperationPolicyContext,
): RustRegExpReplacementCallbackContract | undefined {
  const callable = context.currentSemantics.types.callable(sourceType);
  if (callable === undefined ||
    !context.currentSemantics.types.isStringLike(callable.result.selectedType)) {
    return undefined;
  }
  const stringCarrier = rustJsStringTargetType();
  const valueCarrier = rustJsValueTargetType();
  const restCarrier = rustJsArrayTargetType(valueCarrier);
  const parameterCarriers: TargetTypeRef[] = [];
  const projections: ("string" | "value" | "rest-values")[] = [];
  for (const [index, parameter] of callable.parameters.entries()) {
    if (parameter.parameterKind === "rest") {
      if (index !== callable.parameters.length - 1 ||
        !isDynamicArray(parameter.type, context)) {
        return undefined;
      }
      parameterCarriers.push(restCarrier);
      projections.push("rest-values");
      continue;
    }
    if (index === 0 &&
      context.currentSemantics.types.isStringLike(parameter.type)) {
      parameterCarriers.push(stringCarrier);
      projections.push("string");
      continue;
    }
    if (!isDynamic(parameter.type, context)) {
      return undefined;
    }
    parameterCarriers.push(valueCarrier);
    projections.push("value");
  }
  return Object.freeze({
    sourceCarrier: rustCallableTargetType(parameterCarriers, stringCarrier),
    targetCarrier: rustClosureTargetType(
      [rustJsArrayTargetType(valueCarrier)],
      stringCarrier,
    ),
    projections: Object.freeze(projections),
  });
}

export function applyRustRegExpReplacementCallbackConversion(
  form: RustProviderOperationForm,
  sourceArgumentIndex: number,
  sourceArgumentCount: number,
  contract: RustRegExpReplacementCallbackContract,
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
    source: contract.sourceCarrier,
    target: contract.targetCarrier,
    projections: contract.projections,
  });
  return Object.freeze({ ...form, argConversions: Object.freeze(conversions) });
}

function isReplacementOperation(ownerName: string, memberName: string): boolean {
  const identity = jsRegExpSourceProfileIdentity;
  return ownerName === identity.owners.string &&
      (memberName === identity.stringMembers.replace ||
        memberName === identity.stringMembers.replaceAll) ||
    ownerName === identity.owners.regExp &&
      memberName === identity.wellKnownMemberKeys.replace;
}

function isCanonicalReplacementCallback(
  type: Type,
  context: RustOperationPolicyContext,
): boolean {
  const callable = context.currentSemantics.types.callable(type);
  const first = callable?.parameters[0];
  const rest = callable?.parameters[1];
  return callable !== undefined && callable.parameters.length === 2 &&
    first !== undefined && first.parameterKind !== "rest" &&
    context.currentSemantics.types.isStringLike(first.type) &&
    rest !== undefined && rest.parameterKind === "rest" &&
    isDynamicArray(rest.type, context) &&
    context.currentSemantics.types.isStringLike(callable.result.selectedType);
}

function isDynamic(type: Type | undefined, context: RustOperationPolicyContext): boolean {
  return type !== undefined &&
    (context.currentSemantics.types.isAny(type) ||
      context.currentSemantics.types.isUnknown(type));
}

function isDynamicArray(
  type: Type | undefined,
  context: RustOperationPolicyContext,
): boolean {
  if (type === undefined || !context.currentSemantics.types.isArrayLike(type)) {
    return false;
  }
  const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type) ??
    context.currentSemantics.types.typeArguments(type);
  return arguments_.length === 1 && isDynamic(arguments_[0], context);
}
