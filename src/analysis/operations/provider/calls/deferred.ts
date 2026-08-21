import { acceptRustPolicy } from "../../../../policy/operations/contracts.js";
import { acceptSelectedCall, mapSelectedTargetTypeArguments, selectRustOptionalCallResult } from "./instantiation.js";
import { defaultValueFactKey, flowStateFactKey } from "@tsonic/tsts";
import { finalizeRustCallbackOperation } from "../callbacks.js";
import { rejectSelectedOperation } from "../result.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { rustSelectedCallKey, rustSelectedOperationKey } from "../../../../policy/model/selections.js";
import { rustTargetOperationFactKey } from "../../../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol } from "../operators.js";
import { selectRustTypedLocationCall } from "../../typed-locations.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../../policy/operations/contracts.js";
import type { Node, ProviderDeclarationIdentity, SourceCallMarkerKind } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustProviderOperationTemplate, RustTargetOperationFact } from "../../../facts/keys.js";
import type { RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";

export interface RustPreparedDeferredCheckedCall {
  readonly sourceName: string;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly callback: import("../../../facts/keys.js").RustCallbackOperationTemplate;
  readonly template: RustProviderOperationTemplate;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly resultCarrier: TargetTypeRef;
}

export function prepareRustDeferredCheckedCall(
  request: RustCheckedCallSelectionInput,
  deferred: Extract<
    RustCheckedCallSelectionResult,
    { readonly kind: "deferred-callback" }
  >,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  resolveArgument: (
    argument: Node,
    expected: TargetTypeRef | undefined,
  ) => TargetTypeRef | undefined,
): RustPolicySelection<RustPreparedDeferredCheckedCall> {
  const arguments_ = selectedCallArgumentNodes(request);
  if (arguments_.length !== deferred.parameterCarriers.length) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_ARITY_MISMATCH",
      `Selected callback call '${deferred.sourceName}' has ${arguments_.length} source arguments but ${deferred.parameterCarriers.length} target parameters.`,
    );
  }
  const actual: (TargetTypeRef | undefined)[] = new Array(arguments_.length);
  if (deferred.callback.shape === "reduce") {
    const accumulatorIndex = deferred.callback.accumulatorArgumentIndex;
    const accumulatorArgument = accumulatorIndex === undefined
      ? undefined
      : arguments_[accumulatorIndex];
    if (accumulatorArgument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_MISSING",
        "Selected reduce call has no exact accumulator source argument.",
      );
    }
    const accumulatorExpectation = accumulatorIndex === undefined
      ? undefined
      : deferred.parameterCarriers[accumulatorIndex];
    const accumulator = resolveArgument(
      accumulatorArgument,
      accumulatorExpectation,
    );
    if (accumulator === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_CARRIER_MISSING",
        "Selected reduce call has no closed target carrier for its exact accumulator argument.",
      );
    }
    actual[accumulatorIndex!] = accumulator;
    const callbackArgument = arguments_[deferred.callback.sourceArgumentIndex];
    const callbackTemplate = deferred.parameterCarriers[deferred.callback.sourceArgumentIndex];
    if (callbackArgument === undefined || callbackTemplate === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
        "Selected reduce call has no exact callback argument or callback target template.",
      );
    }
    actual[deferred.callback.sourceArgumentIndex] = resolveArgument(
      callbackArgument,
      replaceRustInferCarrier(callbackTemplate, accumulator),
    );
  } else {
    for (const [index, argument] of arguments_.entries()) {
      actual[index] = resolveArgument(
        argument,
        deferred.parameterCarriers[index],
      );
    }
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
      `Selected callback call '${deferred.sourceName}' has no closed callback/result carrier from exact target analysis.`,
    );
  }
  const finalized = finalizeRustCallbackOperation({
    fact: deferred.template,
    parameterCarriers: deferred.parameterCarriers,
    callback: deferred.callback,
  }, actual as TargetTypeRef[]);
  if (finalized?.fact.kind !== "provider-operation") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_CONFLICT",
      `Selected callback call '${deferred.sourceName}' has callback argument carriers incompatible with its exact target operation row.`,
    );
  }
  const parameterCarriers = finalized.parameterCarriers;
  if (parameterCarriers === undefined || parameterCarriers.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_PARAMETER_CARRIER_MISSING",
      `Selected callback call '${deferred.sourceName}' did not finalize every callback parameter carrier.`,
    );
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    finalized.fact.resultCarrier,
    context,
    options,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  return acceptRustPolicy({
    sourceName: deferred.sourceName,
    ...(deferred.providerDeclaration === undefined
      ? {}
      : { providerDeclaration: deferred.providerDeclaration }),
    callback: deferred.callback,
    template: finalized.fact,
    parameterCarriers: parameterCarriers as readonly TargetTypeRef[],
    resultCarrier: optionalResult.resultCarrier,
  });
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackFallible: boolean,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const template = callbackFallible
    ? callbackFallibleTemplate(prepared)
    : prepared.template;
  return acceptSelectedCall(
    request,
    template,
    prepared.parameterCarriers,
    context,
    options,
    {
      sourceName: prepared.sourceName,
      ...(prepared.providerDeclaration === undefined
        ? {}
        : { providerDeclaration: prepared.providerDeclaration }),
    },
  );
}

function callbackFallibleTemplate(
  prepared: RustPreparedDeferredCheckedCall,
): RustProviderOperationTemplate {
  const { errorCarrier: _providerErrorCarrier, ...template } = prepared.template;
  return {
    ...template,
    target: prepared.callback.fallibleTarget,
    isFallible: true,
    errorBoundary: "source-program",
  };
}

function replaceRustInferCarrier(
  template: TargetTypeRef,
  replacement: TargetTypeRef,
): TargetTypeRef {
  if (template.kind === "opaque" && template.id === "tsonic.rust.infer") {
    return replacement;
  }
  if (template.kind === "function-pointer" || template.kind === "closure") {
    return {
      ...template,
      args: template.args.map((argument) =>
        replaceRustInferCarrier(argument, replacement)),
      result: replaceRustInferCarrier(template.result, replacement),
    };
  }
  return template;
}

export function mapRustSourceMarkerCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  markerName: SourceCallMarkerKind,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  if (markerName === "default-value") {
    return mapRustDefaultValueCall(request, provider, context, options);
  }
  const typedLocation = selectRustTypedLocationCall(
    request,
    provider,
    markerName,
    context,
    options,
  );
  if (typedLocation !== undefined) {
    return typedLocation;
  }
  if (
    markerName !== "shared-borrow" &&
    markerName !== "mutable-borrow" &&
    markerName !== "move"
  ) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SOURCE_MARKER_UNSUPPORTED",
      `Rust does not support selected source marker '${markerName}' in this operation lane.`,
    );
  }
  const flow = context.facts.resolve(request.source.call, flowStateFactKey) ??
    context.facts.get(request.source.call, flowStateFactKey);
  const expectedState = markerName === "shared-borrow"
    ? "borrowed-shared"
    : markerName === "mutable-borrow" ? "borrowed-mut" : "moved";
  if (flow?.state !== expectedState) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_FLOW_MARKER_FACT_NOT_PROVEN",
      `Selected Rust flow marker '${markerName}' requires finalized TSTS flow state '${expectedState}'.`,
    );
  }
  const [argument] = selectedCallArgumentNodes(request);
  const carrier = resolveRustTargetTypeRef(request.source.sourceResultType ?? argument, context, options) ??
    resolveRustTargetTypeRef(argument, context, options);
  if (argument === undefined || carrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_FLOW_MARKER_CARRIER_NOT_PROVEN",
      `Selected Rust flow marker '${markerName}' has no closed target carrier from TSTS evidence.`,
    );
  }
  const fact: RustTargetOperationFact = {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${expectedState}`,
    state: expectedState,
  };
  const evidence = [{ message: `rust selected flow marker ${markerName}` }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  return acceptRustPolicy({
    selectedSignature: {
      member: {
        id: fact.operationId,
        sourceName: markerName,
        targetName: "marker",
        kind: "method",
        parameters: [{ name: "value", type: carrier, passingMode: "by-value" }],
        returnType: carrier,
        providerDeclaration: provider,
      },
      providerDeclaration: provider,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    },
  }, evidence);
}

function mapRustDefaultValueCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = selectedCallArgumentNodes(request);
  const sourceFact = context.facts.resolve(request.source.call, defaultValueFactKey) ??
    context.facts.get(request.source.call, defaultValueFactKey);
  const resultCarrier = resolveRustTargetTypeRef(sourceFact?.type, context, options);
  const sourceTypeArguments = request.source.sourceSelectedMethodTypeArguments;
  const targetTypeArguments = mapSelectedTargetTypeArguments(request, context, options);
  if (sourceArguments.length !== 0 || sourceFact === undefined || resultCarrier === undefined ||
    sourceTypeArguments?.length !== 1 ||
    targetTypeArguments === undefined || targetTypeArguments.length !== 1 ||
    !rustTargetTypeRefEquals(targetTypeArguments[0], resultCarrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_DEFAULT_VALUE_EVIDENCE_NOT_PROVEN",
      "defaultValue<T>() requires one exact source-core type fact, one matching selected type argument, no arguments, and one matching Rust result carrier.",
    );
  }
  const operationId = "tsonic.rust.default-value";
  const fact: Extract<RustTargetOperationFact, { readonly kind: "default-value" }> = {
    kind: "default-value",
    operationId,
    resultCarrier,
  };
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "method",
    targetOperation: "Default::default",
    resultType: resultCarrier,
    providerDeclaration: provider,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
      providerDeclaration: provider,
    },
  };
  const member: RustTargetMember = {
    id: operationId,
    sourceName: "defaultValue",
    targetName: "Default::default",
    kind: "method",
    static: true,
    parameters: [],
    returnType: resultCarrier,
    typeParameters: [{ name: sourceTypeArguments[0]!.typeParameterName }],
    providerDeclaration: provider,
  };
  const selectedSignature = {
    member,
    providerDeclaration: provider,
    targetTypeArguments,
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(selectedCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    sourceSelectedMethodTypeArguments: sourceTypeArguments,
  };
  const evidence = [{ message: "rust selected source-core defaultValue<T>()" }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}
