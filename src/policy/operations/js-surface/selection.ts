import {
  getRustJsMapTargetTypes,
  getRustJsSetElementTargetType,
  rustCarrierSupportsClone,
  rustCarrierSupportsJsEquality,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  rustJsArrayLikeElementTargetType,
  isRustSourceStringConvertibleCarrier,
  rustJsValueTargetType,
  rustJsErrorTargetType,
  rustJsStringTargetId,
  rustJsStringTargetType,
  rustStringTargetId,
  rustVecTargetType,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustJsDateTargetId,
  rustJsRegExpExecArrayTargetType,
  rustJsRegExpIndicesTargetType,
  rustJsRegExpMatchArrayTargetType,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedGroupsTargetType,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpNamedIndicesTargetType,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpStringIteratorTargetType,
  rustJsRegExpTargetId,
  rustJsRegExpTargetType,
  rustRegExpExecArrayTargetType,
  rustRegExpIndicesTargetType,
  rustRegExpMatchArrayTargetType,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedGroupsTargetType,
  rustRegExpNamedIndicesTargetId,
  rustRegExpNamedIndicesTargetType,
  rustRegExpStringIteratorTargetId,
  rustRegExpStringIteratorTargetType,
  rustJsArrayTargetType,
  isRustCallableCarrier,
  rustClosureTargetType,
  rustNullTargetType,
  rustOptionTargetType,
  rustUndefinedTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import { jsOperationRows, rustInferCarrier } from "./rows.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { JsCarrierRef, JsLane, JsOperationRequest, JsOperationRowData, JsOperationSelection } from "./model.js";
import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
  readonly selectedMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly authoredMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly arguments?: readonly (TargetTypeRef | undefined)[];
}

function laneOf(carrier: TargetTypeRef | undefined, ownerName: string): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
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
    if (carrier.id === rustJsDateTargetId) {
      return { lane: "date", bindings: { receiver: carrier } };
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
  if (isRustBoolCarrier(carrier)) {
    return { lane: "boolean", bindings: { receiver: carrier } };
  }
  // Static owners have no receiver carrier; the lane comes from the owner row.
  if (carrier === undefined && ownerName === "StringConstructor") {
    return { lane: "string", bindings: {} };
  }
  if (carrier === undefined && ownerName === "ArrayConstructor") {
    return { lane: "js-array", bindings: {} };
  }
  if (carrier === undefined && ownerName === "DateConstructor") {
    return { lane: "date", bindings: {} };
  }
  if (carrier === undefined && ownerName === "JSON") {
    return { lane: "json", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Math") {
    return { lane: "math", bindings: {} };
  }
  if (carrier === undefined && ownerName === "NumberConstructor") {
    return { lane: "number", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Global") {
    return { lane: "global", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Console") {
    return { lane: "console", bindings: {} };
  }
  if (carrier === undefined && ownerName === "ObjectConstructor") {
    return { lane: "object", bindings: {} };
  }
  if (carrier === undefined && ownerName === "RegExpConstructor") {
    return { lane: "regexp", bindings: {} };
  }
  return undefined;
}

export function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "cb-array-from-map": {
      const source = bindings.selectedMethodTypeArguments?.[0];
      const result = bindings.selectedMethodTypeArguments?.[1];
      const args = [source, rustSourcePrimitiveTargetType("float64")].slice(0, reference.arity);
      return result === undefined || args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], result);
    }
    case "cb-array-predicate":
      return arrayCallbackCarrier(bindings, reference.arity, rustSourcePrimitiveTargetType("bool"));
    case "cb-array-map":
      return arrayCallbackCarrier(
        bindings,
        reference.arity,
        bindings.authoredMethodTypeArguments?.[0] ?? rustInferCarrier,
      );
    case "cb-array-for-each":
      return arrayCallbackCarrier(bindings, reference.arity, rustUnitTargetType());
    case "cb-array-comparator": {
      const args = [bindings.element, bindings.element].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(
            args as TargetTypeRef[],
            rustSourcePrimitiveTargetType("float64"),
          );
    }
    case "cb-array-reduce":
      return arrayReduceCallbackCarrier(bindings, reference.arity, rustInferCarrier);
    case "cb-array-reduce-first":
      return bindings.element === undefined
        ? undefined
        : arrayReduceCallbackCarrier(bindings, reference.arity, bindings.element);
    case "cb-map-for-each": {
      const args = [bindings.mapValue, bindings.mapKey, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
    case "cb-set-for-each": {
      const args = [bindings.setValue, bindings.setValue, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
    case "int32":
      return rustSourcePrimitiveTargetType("int32");
    case "jsvalue":
      return rustJsValueTargetType();
    case "string-array":
      return rustJsArrayTargetType(rustStringTargetType());
    case "js-string-array":
      return rustJsArrayTargetType(rustJsStringTargetType());
    case "regexp":
      return rustJsRegExpTargetType();
    case "regexp-exec-array":
      return rustRegExpExecArrayTargetType();
    case "regexp-match-array":
      return rustRegExpMatchArrayTargetType();
    case "regexp-indices":
      return rustRegExpIndicesTargetType();
    case "regexp-named-groups":
      return rustRegExpNamedGroupsTargetType();
    case "regexp-named-indices":
      return rustRegExpNamedIndicesTargetType();
    case "regexp-string-iterator":
      return rustRegExpStringIteratorTargetType();
    case "js-regexp-exec-array":
      return rustJsRegExpExecArrayTargetType();
    case "js-regexp-match-array":
      return rustJsRegExpMatchArrayTargetType();
    case "js-regexp-indices":
      return rustJsRegExpIndicesTargetType();
    case "js-regexp-named-groups":
      return rustJsRegExpNamedGroupsTargetType();
    case "js-regexp-named-indices":
      return rustJsRegExpNamedIndicesTargetType();
    case "js-regexp-string-iterator":
      return rustJsRegExpStringIteratorTargetType();
    case "regexp-index-pair":
      return regexpIndexPairTargetType();
    case "option-of-regexp-exec-array":
      return rustOptionTargetType(rustRegExpExecArrayTargetType());
    case "option-of-regexp-match-array":
      return rustOptionTargetType(rustRegExpMatchArrayTargetType());
    case "option-of-regexp-indices":
      return rustOptionTargetType(rustRegExpIndicesTargetType());
    case "option-of-regexp-named-groups":
      return rustOptionTargetType(rustRegExpNamedGroupsTargetType());
    case "option-of-regexp-named-indices":
      return rustOptionTargetType(rustRegExpNamedIndicesTargetType());
    case "option-of-js-regexp-exec-array":
      return rustOptionTargetType(rustJsRegExpExecArrayTargetType());
    case "option-of-js-regexp-match-array":
      return rustOptionTargetType(rustJsRegExpMatchArrayTargetType());
    case "option-of-js-regexp-indices":
      return rustOptionTargetType(rustJsRegExpIndicesTargetType());
    case "option-of-js-regexp-named-groups":
      return rustOptionTargetType(rustJsRegExpNamedGroupsTargetType());
    case "option-of-js-regexp-named-indices":
      return rustOptionTargetType(rustJsRegExpNamedIndicesTargetType());
    case "option-of-regexp-index-pair":
      return rustOptionTargetType(regexpIndexPairTargetType());
    case "option-of-string":
      return rustOptionTargetType(rustStringTargetType());
    case "option-of-js-string":
      return rustOptionTargetType(rustJsStringTargetType());
    case "option-of-string-array":
      return rustOptionTargetType(rustJsArrayTargetType(rustStringTargetType()));
    case "option-of-js-string-array":
      return rustOptionTargetType(rustJsArrayTargetType(rustJsStringTargetType()));
    case "element-array":
      return bindings.element === undefined ? undefined : rustJsArrayTargetType(bindings.element);
    case "option-of-float64":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("float64"));
    case "float64":
      return rustSourcePrimitiveTargetType("float64");
    case "infer":
      return rustInferCarrier;
    case "selected-method-type-argument":
      return bindings.selectedMethodTypeArguments?.[reference.index];
    case "selected-method-input-array": {
      const element = bindings.selectedMethodTypeArguments?.[reference.index];
      return element === undefined ? undefined : rustVecTargetType(element);
    }
    case "selected-method-output-array": {
      const element = bindings.selectedMethodTypeArguments?.[reference.index];
      return element === undefined ? undefined : rustJsArrayTargetType(element);
    }
    case "bool":
      return rustSourcePrimitiveTargetType("bool");
    case "unit":
      return rustUnitTargetType();
    case "string":
      return rustStringTargetType();
    case "js-string":
      return rustJsStringTargetType();
    case "undefined":
      return rustUndefinedTargetType();
    case "element":
      return bindings.element;
    case "option-of-element":
      return bindings.element === undefined ? undefined : rustOptionTargetType(bindings.element);
    case "receiver":
      return bindings.receiver;
    case "map-key":
      return bindings.mapKey;
    case "map-value":
      return bindings.mapValue;
    case "option-of-map-value":
      return bindings.mapValue === undefined ? undefined : rustOptionTargetType(bindings.mapValue);
    case "map-key-array":
      return bindings.mapKey === undefined ? undefined : rustVecTargetType(bindings.mapKey);
    case "map-value-array":
      return bindings.mapValue === undefined ? undefined : rustVecTargetType(bindings.mapValue);
    case "map-entry-array":
      return bindings.mapKey === undefined || bindings.mapValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.mapKey, bindings.mapValue] });
    case "set-value":
      return bindings.setValue;
    case "set-value-array":
      return bindings.setValue === undefined ? undefined : rustVecTargetType(bindings.setValue);
    case "set-entry-array":
      return bindings.setValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.setValue, bindings.setValue] });
    case "argument":
      return bindings.arguments?.[reference.index];
  }
}

function regexpIndexPairTargetType(): TargetTypeRef {
  return {
    kind: "tuple",
    elements: [
      rustSourcePrimitiveTargetType("float64"),
      rustSourcePrimitiveTargetType("float64"),
    ],
  };
}

function arrayCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3,
  result: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [bindings.element, rustSourcePrimitiveTargetType("float64"), bindings.receiver].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], result);
}

function arrayReduceCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3 | 4,
  accumulator: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [
    accumulator,
    bindings.element,
    rustSourcePrimitiveTargetType("float64"),
    bindings.receiver,
  ].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], accumulator);
}

function copyStyleOf(carrier: TargetTypeRef | undefined): { readonly kind: "method"; readonly name: "copied" | "cloned" } {
  return {
    kind: "method",
    name: carrier !== undefined && (carrier.kind === "source-primitive" || isRustNumericCarrier(carrier))
      ? "copied"
      : "cloned",
  };
}

function materializeTarget(
  target: RustProviderOperationForm,
  copyCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm {
  if (target.form !== "receiver-method" || target.chain === undefined) {
    return target;
  }
  return {
    ...target,
    chain: target.chain.map((entry) => entry.kind === "copy-selected-carrier" ? copyStyleOf(copyCarrier) : entry),
  };
}

function materializeVariadicTarget(
  target: RustProviderOperationForm,
  elementCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm | undefined {
  if (target.form === "receiver-tagged-array") {
    if (elementCarrier === undefined) {
      return undefined;
    }
    return {
      ...target,
      elementCarrier: materializeInferredCarrier(target.elementCarrier, elementCarrier),
      alternatives: target.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeInferredCarrier(alternative.inputCarrier, elementCarrier),
      })),
    };
  }
  if (target.form !== "receiver-value-array" && target.form !== "call-value-array") {
    return target;
  }
  const resolvedElementCarrier = target.elementCarrier.kind === "opaque" &&
    target.elementCarrier.id === "tsonic.rust.infer"
    ? elementCarrier
    : target.elementCarrier;
  return resolvedElementCarrier === undefined
    ? undefined
    : { ...target, elementCarrier: resolvedElementCarrier };
}

function materializeInferredCarrier(carrier: TargetTypeRef, inferred: TargetTypeRef): TargetTypeRef {
  if (carrier.kind === "opaque" && carrier.id === "tsonic.rust.infer") {
    return inferred;
  }
  switch (carrier.kind) {
    case "target-named":
      return carrier.genericArguments === undefined
        ? carrier
        : {
            ...carrier,
            genericArguments: carrier.genericArguments.map((argument) =>
              argument.kind === "type"
                ? {
                    kind: "type" as const,
                    type: materializeInferredCarrier(argument.type, inferred),
                  }
                : argument),
          };
    case "array":
      return { ...carrier, element: materializeInferredCarrier(carrier.element, inferred) };
    case "tuple":
      return { ...carrier, elements: carrier.elements.map((element) => materializeInferredCarrier(element, inferred)) };
    case "reference":
      return { ...carrier, referent: materializeInferredCarrier(carrier.referent, inferred) };
    case "pointer":
      return { ...carrier, pointee: materializeInferredCarrier(carrier.pointee, inferred) };
    case "function-pointer":
    case "closure":
      return {
        ...carrier,
        args: carrier.args.map((argument) => materializeInferredCarrier(argument, inferred)),
        result: materializeInferredCarrier(carrier.result, inferred),
      };
    case "associated-type":
      return {
        ...carrier,
        owner: materializeInferredCarrier(carrier.owner, inferred),
        ...(carrier.trait === undefined
          ? {}
          : { trait: materializeInferredCarrier(carrier.trait, inferred) }),
        ...(carrier.genericArguments === undefined
          ? {}
          : {
              genericArguments: carrier.genericArguments.map((argument) =>
                argument.kind === "type"
                  ? {
                      kind: "type" as const,
                      type: materializeInferredCarrier(argument.type, inferred),
                    }
                  : argument),
            }),
      };
    default:
      return carrier;
  }
}

function firstArgumentId(request: JsOperationRequest): string | undefined {
  const carrier = request.argumentCarriers?.[0];
  return carrier?.kind === "target-named" ? carrier.id : undefined;
}

export function selectJsSurfaceOperation(request: JsOperationRequest): JsOperationSelection | undefined {
  const laneMatch = laneOf(request.receiverCarrier, request.ownerName);
  if (laneMatch === undefined) {
    return undefined;
  }
  const { lane } = laneMatch;
  const bindings: JsLaneBindings = {
    ...laneMatch.bindings,
    selectedMethodTypeArguments: request.selectedMethodTypeArgumentCarriers,
    authoredMethodTypeArguments: request.authoredMethodTypeArgumentCarriers,
    arguments: request.argumentCarriers,
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
      (candidate.selectedMethodTypeArgumentArity === undefined ||
        candidate.selectedMethodTypeArgumentArity ===
          (request.selectedMethodTypeArgumentCarriers?.length ?? 0)) &&
      (candidate.callback === undefined || isRustCallableCarrier(callbackArgumentCarrier)) &&
      carrierRequirementsMatch(candidate.requirements, candidateBindings, request) &&
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
    if ((candidate.variadic !== true && parameterCarriers.length !== candidateArgumentCarriers.length) ||
      (candidate.variadic === true && candidateArgumentCarriers.length < parameterCarriers.length)) {
      return [];
    }
    const argumentScores = parameterCarriers.map((carrier, index) =>
          jsArgumentCarrierMatchScore(
            carrier,
            candidateArgumentCarriers[index],
            index,
            request.argumentMatchScore,
          ));
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
  const materializedTarget = materializeVariadicTarget(
    discardResult && row.shape.op === "operation"
      ? row.shape.discardedTarget!
      : row.shape.target,
    bindings.element,
  );
  const target = row.authoredPropertyKey !== true
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
  if (target === undefined) {
    return undefined;
  }
  const selectedParameterCarriers = row.variadic === true ? undefined : parameterCarriers;
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
        parameterCarriers: parameterCarriers as readonly TargetTypeRef[],
      },
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    };
  }
  const resultCarrier = discardResult
    ? rustUnitTargetType()
    : resolveCarrierRef(row.shape.result, bindings);
  const sourceResultCarrier = row.shape.sourceResult === undefined
    ? undefined
    : resolveCarrierRef(row.shape.sourceResult, bindings);
  if (resultCarrier === undefined ||
    (row.shape.sourceResult !== undefined && sourceResultCarrier === undefined)) {
    return undefined;
  }
  const copyReference = row.shape.result.ref === "option-of-map-value" ? bindings.mapValue : bindings.element;
  const callback = row.callback === undefined
    ? undefined
    : {
        ...row.callback,
        fallibleTarget: materializeTarget(row.callback.fallibleTarget, copyReference),
      };
  return {
    fact: {
      kind: "provider-operation",
      operationId,
      operationKind: row.shape.operationKind,
      target: materializeTarget(target, copyReference),
      resultCarrier,
      ...(sourceResultCarrier === undefined ? {} : { sourceResultCarrier }),
      ...(row.shape.sourceAbsence === undefined
        ? {}
        : {
            sourceAbsenceCarrier: row.shape.sourceAbsence === "undefined"
              ? rustUndefinedTargetType()
              : rustNullTargetType(),
          }),
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
      isAsync: false,
      isFallible: row.fallible === true,
      ...(row.shape.evaluation === undefined ? {} : { evaluation: row.shape.evaluation }),
      errorBoundary: row.fallible === true ? "provider-native" : "none",
      ...(row.fallible === true ? { errorCarrier: rustJsErrorTargetType() } : {}),
      ...(discardResult || row.shape.resultConversion === undefined
        ? {}
        : { resultConversion: row.shape.resultConversion }),
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
): boolean {
  return requirements?.every((requirement) => {
    const carrier = resolveCarrierRef(requirement.carrier, bindings);
    switch (requirement.capability) {
      case "numeric":
        return isRustNumericCarrier(carrier);
      case "integer":
        return isRustIntegerCarrier(carrier);
      case "clone":
        return rustCarrierSupportsClone(carrier);
      case "stringifiable":
        return isRustSourceStringConvertibleCarrier(carrier);
      case "js-equality":
        return rustCarrierSupportsJsEquality(carrier);
      case "project-identity-equality":
        return carrier !== undefined && request.carrierSupportsProjectIdentity?.(carrier) === true;
    }
  }) ?? true;
}

function jsArgumentCarrierMatchScore(
  expected: TargetTypeRef | undefined,
  actual: TargetTypeRef | undefined,
  index: number,
  relationScore: JsOperationRequest["argumentMatchScore"],
): number | undefined {
  if (actual === undefined) {
    return expected === undefined
      ? undefined
      : relationScore?.(expected, actual, index);
  }
  if (expected === undefined || (expected.kind === "opaque" && expected.id === "tsonic.rust.infer")) {
    return 0;
  }
  if (expected.kind === "closure" && actual.kind === "closure") {
    if (expected.args.length !== actual.args.length) {
      return relationScore?.(expected, actual, index);
    }
    const scores = [
      ...expected.args.map((argument, argumentIndex) =>
        jsArgumentCarrierMatchScore(argument, actual.args[argumentIndex], index, relationScore)),
      jsArgumentCarrierMatchScore(expected.result, actual.result, index, relationScore),
    ];
    return scores.some((score) => score === undefined)
      ? relationScore?.(expected, actual, index)
      : (scores as number[]).reduce((total, score) => total + score, 0);
  }
  if (rustTargetTypeRefEquals(expected, actual)) {
    return 0;
  }
  return relationScore?.(expected, actual, index);
}

// Constructor rows: matched by lib class declaration identity plus argument
// and type-argument shape guards.
