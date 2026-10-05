import {
  emptyRustTypeDefinitions,
  type RustTypeDefinitions,
} from "../../../../target-model/types/source-union-definitions.js";
import { selectRustNumberArrayUnionOperation } from "./number-array-unions.js";
import { isRustSourceNumberConvertibleCarrier } from "../../../../target-model/types/carriers/traits.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/carriers/optional.js";
import { selectRustNumericRestCarrier } from "./numeric-rest.js";
import { rustJsArrayEntriesElementTargetType } from "../../../../target-model/types/carriers/array-entries.js";
import {
  isRustBigIntCarrier,
  rustEmptyObjectTargetType,
  rustObjectIdentityTargetType,
  rustStructuralObjectCarrierValue,
  getRustJsMapTargetTypes,
  getRustJsSetElementTargetType,
  getRustJsWeakMapTargetTypes,
  getRustJsWeakSetElementTargetType,
  rustCarrierSupportsClone,
  rustCarrierSupportsJsEquality,
  rustCarrierSupportsObjectIdentity,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  rustJsArrayLikeElementTargetType,
  isRustJsArrayValueCarrier,
  isRustSourceStringConvertibleCarrier,
  rustJsErrorTargetType,
  rustJsStringTargetId,
  rustStringTargetId,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustJsDateTargetId,
  rustJsArrayBufferTargetId,
  rustJsDataViewTargetId,
  rustJsIntlCollatorTargetId,
  rustJsIntlDateTimeFormatPartTargetId,
  rustJsIntlDateTimeFormatTargetId,
  rustJsIntlNumberFormatPartTargetId,
  rustJsIntlNumberFormatTargetId,
  rustJsIntlResolvedCollatorOptionsTargetId,
  rustJsIntlResolvedDateTimeFormatOptionsTargetId,
  rustJsIntlResolvedNumberFormatOptionsTargetId,
  rustJsTypedArrayElementTargetType,
  rustJsTypedArrayTargetIds,
  rustFutureOutputCarrier,
  rustJsPromiseOutputTargetType,
  rustJsPromiseFulfilledResultTargetId,
  rustJsPromiseRejectedResultTargetId,
  rustJsPromiseSettledResultTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  isRustCallableCarrier,
  rustCallableProtocol,
  rustClosureProtocol,
  rustAbsenceTargetType,
  rustSourceOptionalTargetType,
  rustUnitTargetType,
} from "../../../../target-model/types/index.js";
import { selectJsArrayConstruction } from "./array-construction.js";
import { selectRustJsPromiseContinuation } from "./promises.js";
import { jsArgumentCarrierMatchScore } from "./argument-matching.js";
import { jsOperationRows } from "./rows.js";
import { selectRustJsonValueConversion } from "../../../conversions/selection.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../../target-model/types/carriers/native.js";
import { materializeJsOperationTarget, materializeJsonValueConversions, materializeTarget, materializeVariadicTarget } from "./materialization.js";
import type { JsLane, JsOperationRequest, JsOperationRowData, JsOperationSelection } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { resolveCarrierRef, type JsLaneBindings } from "./carrier-references.js";


function laneOf(carrier: TargetTypeRef | undefined, ownerName: string): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
  if (isRustJsArrayValueCarrier(carrier)) {
    return { lane: "array-value", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "reference" && carrier.referent.kind === "target-named" && carrier.referent.id === rustStringTargetId) {
    // Borrowed string parameters (&str) share the string lane.
    return { lane: "string", bindings: { receiver: carrier.referent } };
  }
  if (carrier?.kind === "target-named") {
    const arrayElement = rustJsArrayLikeElementTargetType(carrier);
    if (arrayElement !== undefined) {
      return { lane: "js-array", bindings: { element: arrayElement, receiver: carrier } };
    }
    const mapTypes = getRustJsMapTargetTypes(carrier);
    if (mapTypes !== undefined) {
      return { lane: "map", bindings: { mapKey: mapTypes.key, mapValue: mapTypes.value, receiver: carrier } };
    }
    const setValue = getRustJsSetElementTargetType(carrier);
    if (setValue !== undefined) {
      return { lane: "set", bindings: { setValue, receiver: carrier } };
    }
    const weakMapTypes = getRustJsWeakMapTargetTypes(carrier);
    if (weakMapTypes !== undefined) {
      return {
        lane: "weak-map",
        bindings: {
          weakKey: weakMapTypes.key,
          weakValue: weakMapTypes.value,
          receiver: carrier,
        },
      };
    }
    const weakSetValue = getRustJsWeakSetElementTargetType(carrier);
    if (weakSetValue !== undefined) {
      return { lane: "weak-set", bindings: { weakKey: weakSetValue, receiver: carrier } };
    }
    const entryElement = rustJsArrayEntriesElementTargetType(carrier);
    if (entryElement !== undefined) {
      return { lane: "array-entries", bindings: { element: entryElement, receiver: carrier } };
    }
    if (carrier.id === rustJsDateTargetId) {
      return { lane: "date", bindings: { receiver: carrier } };
    }
    const promiseOutput = rustJsPromiseOutputTargetType(carrier);
    if (promiseOutput !== undefined) {
      return {
        lane: "promise",
        bindings: { promiseOutput, receiver: carrier },
      };
    }
    if (carrier.id === rustJsPromiseFulfilledResultTargetId ||
      carrier.id === rustJsPromiseRejectedResultTargetId ||
      carrier.id === rustJsPromiseSettledResultTargetId) {
      return { lane: "promise-record", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsArrayBufferTargetId) {
      return { lane: "array-buffer", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsDataViewTargetId) {
      return { lane: "data-view", bindings: { receiver: carrier } };
    }
    const typedElement = rustJsTypedArrayElementTargetType(carrier);
    if (typedElement !== undefined) {
      return {
        lane: "typed-array",
        bindings: {
          element: typedElement,
          receiver: carrier,
        },
      };
    }
    if (carrier.id === rustJsIntlDateTimeFormatTargetId) {
      return { lane: "intl-date-time", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsIntlNumberFormatTargetId) {
      return { lane: "intl-number", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsIntlCollatorTargetId) {
      return { lane: "intl-collator", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsIntlDateTimeFormatPartTargetId ||
      carrier.id === rustJsIntlNumberFormatPartTargetId ||
      carrier.id === rustJsIntlResolvedDateTimeFormatOptionsTargetId ||
      carrier.id === rustJsIntlResolvedNumberFormatOptionsTargetId ||
      carrier.id === rustJsIntlResolvedCollatorOptionsTargetId) {
      return { lane: "intl-record", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustJsRegExpTargetId) {
      return { lane: "regexp", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustRegExpNamedGroupsTargetId ||
      carrier.id === rustJsRegExpNamedGroupsTargetId) {
      return { lane: "regexp-named-groups", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustRegExpNamedIndicesTargetId ||
      carrier.id === rustJsRegExpNamedIndicesTargetId) {
      return { lane: "regexp-named-indices", bindings: { receiver: carrier } };
    }
    if (carrier.id === rustRegExpStringIteratorTargetId ||
      carrier.id === rustJsRegExpStringIteratorTargetId) {
      return { lane: "regexp-string-iterator", bindings: { receiver: carrier } };
    }
  }
  if (isRustStringCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "target-named" && carrier.id === rustJsStringTargetId) {
    return { lane: "js-string", bindings: { receiver: carrier } };
  }
  if (isRustNumericCarrier(carrier)) {
    return { lane: "number", bindings: { receiver: carrier } };
  }
  if (isRustBigIntCarrier(carrier)) {
    return { lane: "bigint", bindings: { receiver: carrier } };
  }
  if (isRustBoolCarrier(carrier)) {
    return { lane: "boolean", bindings: { receiver: carrier } };
  }
  const staticReceiver = carrier === undefined || isRustCallableCarrier(carrier);
  if (staticReceiver && ownerName === "StringConstructor") {
    return { lane: "string", bindings: {} };
  }
  if (staticReceiver && ownerName === "ArrayConstructor") {
    return { lane: "js-array", bindings: {} };
  }
  if (staticReceiver && ownerName === "DateConstructor") {
    return { lane: "date", bindings: {} };
  }
  if (staticReceiver && ownerName === "JSON") {
    return { lane: "json", bindings: {} };
  }
  if (staticReceiver && ownerName === "Math") {
    return { lane: "math", bindings: {} };
  }
  if (staticReceiver && ownerName === "NumberConstructor") {
    return { lane: "number", bindings: {} };
  }
  if (staticReceiver && ownerName === "BigIntConstructor") {
    return { lane: "bigint", bindings: {} };
  }
  if (staticReceiver && Object.keys(rustJsTypedArrayTargetIds).some((name) => ownerName === `${name}Constructor`)) {
    return { lane: "typed-array", bindings: {} };
  }
  if (staticReceiver && ownerName === "Global") {
    return { lane: "global", bindings: {} };
  }
  if (staticReceiver && ownerName === "Atomics") {
    return { lane: "global", bindings: {} };
  }
  if (staticReceiver && ownerName === "Console") {
    return { lane: "console", bindings: {} };
  }
  if (staticReceiver && ownerName === "ObjectConstructor") {
    return { lane: "object", bindings: {} };
  }
  if (staticReceiver && ownerName === "RegExpConstructor") {
    return { lane: "regexp", bindings: {} };
  }
  if (staticReceiver && ownerName === "SymbolConstructor") {
    return { lane: "symbol", bindings: {} };
  }
  if (staticReceiver && ownerName === "PromiseConstructor") {
    return { lane: "promise", bindings: {} };
  }
  return undefined;
}


function firstArgumentId(request: JsOperationRequest): string | undefined {
  const carrier = request.argumentCarriers?.[0];
  return carrier?.kind === "target-named" ? carrier.id : undefined;
}

export function selectJsSurfaceOperation(request: JsOperationRequest, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): JsOperationSelection | undefined {
  const demand = request.accessMode === "write" &&
    (request.operationKind === "indexer" || request.operationKind === "property") ? "storage" : "operation";
  return selectJsSurfaceOperationForDemand(request, definitions, demand);
}

export function selectJsSurfaceCallInputContract(
  request: JsOperationRequest,
  argumentIndex: number,
  definitions: RustTypeDefinitions,
): JsOperationSelection | undefined {
  if (request.operationKind !== "call" || !Number.isSafeInteger(argumentIndex) ||
    argumentIndex < 0 || argumentIndex >= (request.argumentCarriers?.length ?? 0)) return undefined;
  return selectJsSurfaceOperationForDemand(request, definitions, { kind: "input", argumentIndex });
}

type JsSelectionDemand = "operation" | "storage" | { readonly kind: "input"; readonly argumentIndex: number };

export function selectJsSurfaceMemberStorageContract(
  request: JsOperationRequest & { readonly operationKind: "property" | "indexer" },
  definitions: RustTypeDefinitions,
) {
  const selected = selectJsSurfaceOperationForDemand(request, definitions, "storage");
  if (selected?.fact.kind !== "provider-operation" || selected.callback !== undefined) return undefined;
  const { operationId: _operationId, indexedLocationMethod: _location, carrierRequirements: _requirements, ...contract } = selected.fact;
  return contract;
}

function selectJsSurfaceOperationForDemand(
  request: JsOperationRequest,
  definitions: RustTypeDefinitions,
  demand: JsSelectionDemand,
): JsOperationSelection | undefined {
  if (request.ownerName === "Promise" && (request.memberName === "then" || request.memberName === "catch")) {
    return selectRustJsPromiseContinuation(request);
  }
  const numberArrayUnion = selectRustNumberArrayUnionOperation(request, definitions);
  if (numberArrayUnion !== undefined) return numberArrayUnion;
  const upcasts = rustNamedTypeCarrierValue(request.receiverCarrier)?.upcasts ?? [];
  if (upcasts.length > 0) {
    const selected = upcasts.filter((upcast) => laneOf(upcast.target, request.ownerName) !== undefined);
    if (selected.length !== 1) return undefined;
    const receiverCarrier = selected[0]!.target;
    const result = selectJsSurfaceOperationForDemand({ ...request, receiverCarrier }, definitions, demand);
    if (result?.fact.target.form !== "receiver-method" || result.fact.target.receiverConversion !== undefined) return undefined;
    return {
      ...result, fact: { ...result.fact, target: {
        ...result.fact.target,
        receiverConversion: { kind: "native-upcast", source: request.receiverCarrier!, target: receiverCarrier, path: selected[0]!.path },
      } },
    };
  }
  if (request.ownerName === "ArrayConstructor" && request.memberName === "call" && request.operationKind === "call") {
    return selectJsArrayConstruction(request.selectedMethodTypeArgumentCarriers ?? [], request.argumentCarriers ?? [], "method", request.soleArgumentNumberKind);
  }
  const laneMatch = laneOf(request.receiverCarrier, request.ownerName);
  if (laneMatch === undefined) {
    return undefined;
  }
  const { lane } = laneMatch;
  const bindings: JsLaneBindings = {
    ...laneMatch.bindings,
    storageContract: request.storageContract,
    sourceResult: request.sourceResultCarrier,
    selectedMethodTypeArguments: request.selectedMethodTypeArgumentCarriers,
    authoredMethodTypeArguments: request.authoredMethodTypeArgumentCarriers,
    arguments: request.argumentCarriers,
    promiseInputOutput: rustFutureOutputCarrier(
      rustJsArrayLikeElementTargetType(request.argumentCarriers?.[0]),
    ),
    ...(lane === "js-array" && laneMatch.bindings.element === undefined &&
        request.selectedMethodTypeArgumentCarriers?.length === 1 &&
        request.selectedMethodTypeArgumentCarriers[0] !== undefined
      ? { element: request.selectedMethodTypeArgumentCarriers[0] }
      : {}),
  };
  const argumentCarriers = request.argumentCarriers ?? [];
  const matches = jsOperationRows.flatMap((candidate) => {
    const callback = candidate.callback;
    const callbackArgumentIndex = callback?.sourceArgumentIndex;
    const callbackArgumentCarrier = callback === undefined
      ? undefined
      : argumentCarriers[callback.sourceArgumentIndex] ??
        request.resolveCallbackArgumentCarrier?.(callback);
    const candidateArgumentCarriers = callbackArgumentIndex === undefined ||
        callbackArgumentCarrier === undefined ||
        argumentCarriers[callbackArgumentIndex] === callbackArgumentCarrier
      ? argumentCarriers
      : argumentCarriers.map((carrier, index) =>
          index === callbackArgumentIndex ? callbackArgumentCarrier : carrier);
    const candidateBindings = candidateArgumentCarriers === argumentCarriers
      ? bindings
      : { ...bindings, arguments: candidateArgumentCarriers };
    if (!(
      candidate.owner === request.ownerName &&
      candidate.member === request.memberName &&
      candidate.operationKind === request.operationKind &&
      candidate.lane === lane &&
      (candidate.sourceValueTypeArgument === undefined || request.argumentMatchesSelectedTypeArgument?.(
        candidate.sourceValueTypeArgument.argumentIndex, candidate.sourceValueTypeArgument.typeArgumentIndex) === true) &&
      (candidate.selectedMethodTypeArgumentArity === undefined ||
        candidate.selectedMethodTypeArgumentArity ===
          (request.selectedMethodTypeArgumentCarriers?.length ?? 0)) &&
      (candidate.callback === undefined || callbackArgumentCarrier === undefined ||
        isRustCallableCarrier(callbackArgumentCarrier)) &&
      carrierRequirementsMatch(candidate.requirements, candidateBindings, request, definitions, demand) &&
      (candidate.firstArgCarrierId === undefined
        ? firstArgumentId(request) === undefined || !jsOperationRows.some((other) =>
            other.owner === candidate.owner && other.member === candidate.member &&
            other.operationKind === candidate.operationKind && other.firstArgCarrierId === firstArgumentId(request))
        : candidate.firstArgCarrierId === firstArgumentId(request))
    )) {
      return [];
    }
    const parameterCarriers = (candidate.shape.params ?? []).map((reference) =>
      reference === undefined ? undefined : resolveCarrierRef(reference, candidateBindings));
    if (parameterCarriers.some((carrier, index) =>
      carrier === undefined && candidate.shape.params?.[index] !== undefined)) return [];
    if ((candidate.variadic !== true && parameterCarriers.length !== candidateArgumentCarriers.length) ||
      (candidate.variadic === true && candidateArgumentCarriers.length < parameterCarriers.length)) {
      return [];
    }
    const argumentScores = parameterCarriers.map((carrier, index) => {
      const actual = candidateArgumentCarriers[index];
      if (typeof demand === "object" && index === demand.argumentIndex) {
        const expectedCallable = rustCallableProtocol(carrier) ?? rustClosureProtocol(carrier);
        const actualCallable = rustCallableProtocol(actual) ?? rustClosureProtocol(actual);
        return expectedCallable === undefined || actualCallable === undefined ||
          expectedCallable.parameters.length !== actualCallable.parameters.length ? undefined
          : jsArgumentCarrierMatchScore(expectedCallable.result, actualCallable.result, index, request.argumentMatchScore);
      }
      if (candidate.jsonValueSourceArgumentIndexes?.includes(index) === true) {
        return actual !== undefined && selectRustJsonValueConversion(actual, definitions) !== undefined
          ? 1
          : undefined;
      }
      return jsArgumentCarrierMatchScore(
        carrier,
        actual,
        index,
        request.argumentMatchScore,
      );
    });
    if (argumentScores.some((score) => score === undefined)) {
      return [];
    }
    return [{
      row: candidate,
      parameterCarriers,
      score: (argumentScores as number[]).reduce((total, score) => total + score, 0),
    }];
  });
  const minimumScore = matches.reduce(
    (minimum, candidate) => Math.min(minimum, candidate.score),
    Number.POSITIVE_INFINITY,
  );
  const bestMatches = matches.filter((candidate) => candidate.score === minimumScore);
  if (bestMatches.length !== 1) {
    return undefined;
  }
  const selected = bestMatches[0];
  if (selected === undefined) {
    return undefined;
  }
  const { row, parameterCarriers } = selected;
  const discardResult = request.resultUse === "discarded" &&
    row.shape.op === "operation" && row.shape.discardedTarget !== undefined;
  const selectedTarget = discardResult && row.shape.op === "operation"
    ? row.shape.discardedTarget
    : materializeJsOperationTarget(row.shape.target, bindings);
  if (selectedTarget === undefined) return undefined;
  const variadicTarget = materializeVariadicTarget(
    selectedTarget,
    bindings.element,
    parameterCarriers,
  );
  const numericRestCarrier = row.numericRest === true
    ? selectRustNumericRestCarrier(argumentCarriers, request.spreadArgumentIndexes ?? []) : undefined;
  const materializedTarget = row.numericRest !== true ? variadicTarget
    : numericRestCarrier === undefined || variadicTarget?.form !== "call-value-slice" ? undefined
    : { ...variadicTarget, elementCarrier: numericRestCarrier };
  const authoredTarget = row.authoredPropertyKey !== true
    ? materializedTarget
    : request.authoredPropertyKey === undefined ||
        request.authoredPropertyKey.length === 0 ||
        materializedTarget?.form !== "free-call"
      ? undefined
      : {
          ...materializedTarget,
          trailingArguments: [
            ...(materializedTarget.trailingArguments ?? []),
            { kind: "string" as const, value: request.authoredPropertyKey },
          ],
        };
  const target = authoredTarget === undefined
    ? undefined
    : materializeJsonValueConversions(
        authoredTarget,
        row.jsonValueSourceArgumentIndexes,
        request.argumentCarriers ?? [], definitions,
      );
  if (target === undefined) {
    return undefined;
  }
  const selectedParameterCarriers = row.variadic === true
    ? undefined
    : parameterCarriers.map((carrier, index) =>
        row.jsonValueSourceArgumentIndexes?.includes(index) === true
          ? request.argumentCarriers?.[index]
          : carrier);
  const evaluationOnlySourceArgumentIndexes = new Set(
    row.evaluationOnlySourceArgumentIndexes ?? [],
  );
  const declaredRuntimeParameterCarriers = selectedParameterCarriers?.filter(
    (_carrier, index) => !evaluationOnlySourceArgumentIndexes.has(index),
  );
  const operationId = `tsonic.rust.js.${row.owner}.${row.member}.${row.operationKind}${row.variant === undefined ? "" : `.${row.variant}`}${discardResult ? ".discarded" : ""}`;
  if (row.shape.op === "set") {
    if (parameterCarriers.some((carrier) => carrier === undefined)) {
      return undefined;
    }
    return {
      fact: {
        kind: "runtime-set",
        operationId,
        target,
        ...(row.fallible === true ? { fallible: true } : {}),
        parameterCarriers: parameterCarriers as readonly TargetTypeRef[],
      },
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    };
  }
  const rawResultCarrier = discardResult
    ? rustUnitTargetType()
    : resolveCarrierRef(row.shape.result, bindings);
  const sourceResultCarrier = row.shape.sourceResult === undefined
    ? undefined
    : resolveCarrierRef(row.shape.sourceResult, bindings);
  if (rawResultCarrier === undefined ||
    (row.shape.sourceResult !== undefined && sourceResultCarrier === undefined)) {
    return undefined;
  }
  const absentElement = !discardResult && row.shape.sourceAbsence !== undefined && row.shape.resultConversion === undefined
    ? rustOptionElementCarrier(rawResultCarrier) : undefined;
  const resultCarrier = absentElement === undefined ? rawResultCarrier : rustSourceOptionalTargetType(absentElement);
  const resultConversion = discardResult ? undefined : absentElement !== undefined &&
      !rustTargetTypeRefEquals(rawResultCarrier, resultCarrier)
    ? { kind: "source-optional" as const, element: absentElement } : row.shape.resultConversion;
  const copyReference = row.shape.result.ref === "option-of-map-value" ? bindings.mapValue : bindings.element;
  const callback = row.callback === undefined
    ? undefined
    : {
        ...row.callback,
        failure: row.callback.failure.kind === "returned-future"
          ? row.callback.failure
          : {
              kind: "invocation" as const,
              fallibleTarget: materializeTarget(
                row.callback.failure.fallibleTarget,
                copyReference,
              ),
            },
      };
  return {
    fact: {
      kind: "provider-operation",
      operationId,
      ...((row.requirements ?? []).some(requirement => requirement.capability === "numeric-parameter" ||
        requirement.capability === "number-parameter" ||
        demand === "operation" && requirement.capability === "clone" && !rustCarrierSupportsClone(resolveCarrierRef(requirement.carrier, bindings), definitions))
        ? { carrierRequirements: Object.freeze((row.requirements ?? [])
            .filter(requirement => demand === "operation" && requirement.capability === "clone" || requirement.capability === "numeric-parameter" ||
              requirement.capability === "number-parameter")
            .map(requirement => Object.freeze({
              carrier: resolveCarrierRef(requirement.carrier, bindings)!,
              requirement: requirement.capability === "clone" ? "clone" as const
                : requirement.capability === "number-parameter" ? "number-predicate" as const : "source-numeric" as const,
            }))) }
        : {}),
      operationKind: row.shape.operationKind,
      target: materializeTarget(target, copyReference),
      ...(numericRestCarrier === undefined ? {} : {
        targetGenericArguments: [{ kind: "type" as const, type: numericRestCarrier }],
      }),
      ...(row.shape.indexedLocationMethod === undefined ? {} : { indexedLocationMethod: row.shape.indexedLocationMethod }),
      ...(row.shape.borrowedIndexOperation === undefined ? {} : {
        borrowedIndexOperation: Object.freeze({ ...row.shape.borrowedIndexOperation }),
      }),
      resultCarrier,
      ...(sourceResultCarrier === undefined ? {} : { sourceResultCarrier }),
      ...(row.shape.sourceAbsence === undefined
        ? {}
        : {
            sourceAbsenceCarrier: row.shape.sourceAbsence === "undefined"
              ? rustAbsenceTargetType()
              : rustAbsenceTargetType(),
          }),
      ...(declaredRuntimeParameterCarriers === undefined
        ? {}
        : { parameterCarriers: declaredRuntimeParameterCarriers }),
      ...(row.evaluationOnlySourceArgumentIndexes === undefined
        ? {}
        : {
            evaluationOnlySourceArgumentIndexes:
              row.evaluationOnlySourceArgumentIndexes,
          }),
      isAsync: row.asynchronous === true,
      isFallible: row.fallible === true,
      ...(row.returnedFuture === undefined
        ? {}
        : { returnedFuture: row.returnedFuture }),
      ...(row.shape.evaluation === undefined ? {} : { evaluation: row.shape.evaluation }),
      errorBoundary: row.fallible === true ? "provider-native" : "none",
      ...(row.fallible === true ? { errorCarrier: rustJsErrorTargetType() } : {}),
      ...(resultConversion === undefined
        ? {}
        : { resultConversion }),
    },
    resultCarrier,
    ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    ...(callback === undefined ? {} : { callback }),
  };
}


function carrierRequirementsMatch(
  requirements: JsOperationRowData["requirements"],
  bindings: JsLaneBindings,
  request: JsOperationRequest,
  definitions: RustTypeDefinitions,
  demand: JsSelectionDemand,
): boolean {
  return requirements?.every((requirement) => {
    const carrier = resolveCarrierRef(requirement.carrier, bindings);
    switch (requirement.capability) {
      case "numeric":
        return isRustNumericCarrier(carrier);
      case "integer":
        return isRustIntegerCarrier(carrier);
      case "numeric-parameter":
      case "number-parameter":
        return carrier?.kind === "type-parameter" && requirement.carrier.ref === "argument" &&
          request.numericParameterArgument?.(requirement.carrier.index, carrier,
            requirement.capability === "number-parameter" ? "number" : "numeric") === true;
      case "clone":
        return demand === "storage" || rustCarrierSupportsClone(carrier, definitions) ||
          (carrier !== undefined && request.canRequireClone?.(carrier) === true);
      case "stringifiable":
        return isRustSourceStringConvertibleCarrier(carrier);
      case "optional-number":
        return rustOptionElementCarrier(carrier) !== undefined && isRustSourceNumberConvertibleCarrier(carrier);
      case "js-equality":
        return rustCarrierSupportsJsEquality(carrier);
      case "project-identity-equality":
        return carrier !== undefined && request.carrierSupportsProjectIdentity?.(carrier) === true;
      case "object-identity":
        return rustCarrierSupportsObjectIdentity(carrier) ||
          (carrier !== undefined && request.carrierSupportsProjectIdentity?.(carrier) === true);
      case "freezable-object": {
        const shape = rustStructuralObjectCarrierValue(carrier);
        return rustTargetTypeRefEquals(carrier, rustEmptyObjectTargetType()) ||
          rustTargetTypeRefEquals(carrier, rustObjectIdentityTargetType()) ||
          (carrier !== undefined && request.carrierSupportsProjectIdentity?.(carrier) === true) ||
          shape?.representation === "reference" && shape.fields.every(field => field.bound !== true);
      }
    }
  }) ?? true;
}
