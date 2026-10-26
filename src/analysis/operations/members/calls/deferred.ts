import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { acceptRustPolicy } from "../../../../policy/model/contracts.js";
import { acceptSelectedCall, mapSelectedTargetTypeArguments } from "./instantiation.js";
import { selectRustOptionalCallResult } from "./optional-results.js";
import { defaultValueFactKey, fieldFactKey, flowStateFactKey } from "@tsonic/tsts";
import { finalizeRustCallbackOperation, replaceRustInferCarrier, rustCallbackProtocol } from "../../../../policy/operations/members/callbacks.js";
import { rustSelectedCallTypeParameters } from "../../../source-evidence/types/resolution/generic-arguments.js";
import { selectedRustRegExpReplacementCallbackEvidence } from "../regexp-replacement-callback.js";
import { applyRustRegExpReplacementCallbackConversion, finalizeRustRegExpReplacementCallbackContract } from "../../../../policy/operations/members/regexp-callbacks.js";
import { rejectSelectedOperation } from "../result.js";
import { resolveRustTargetTypeRef } from "../../../source-evidence/types/resolution/source.js";
import { rustSourceStorageSubjectContext } from "../../../source-evidence/types/resolution/source-storage-projection.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedCallArgumentNodes, selectedCallCalleeSymbol } from "../operators.js";
import { selectRustTypedLocationCall } from "../../typed-locations.js";
import { selectedRustCallSignature } from "../../../program/records/selected-call.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection, RustTargetOperationSelection } from "../../../../policy/model/contracts.js";
import type { Node, ProviderDeclarationIdentity, SourceCallMarkerKind } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "../model.js";

import type { RustTargetOperationFact } from "../../../../target-model/records/operations.js";
import type { RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustJsStringTargetType, rustStringTargetType, rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/conversions/value-carrier-reconciliation.js";

import type { RustPreparedDeferredCheckedCall } from "../../../../target-model/records/deferred-callbacks.js";
import { callbackFallibleTemplate, type RustPreparedCallbackEffects } from "../../../../policy/operations/members/deferred-callbacks.js";
export function prepareRustDeferredCheckedCall(
  request: RustCheckedCallSelectionInput,
  deferred: Extract<
    RustCheckedCallSelectionResult,
    { readonly kind: "deferred-callback" }
  >,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  resolveArgument: (
    argument: Node,
    expected: TargetTypeRef | undefined,
  ) => TargetTypeRef | undefined,
): RustPolicySelection<RustPreparedDeferredCheckedCall> {
  const arguments_ = selectedCallArgumentNodes(request);
  const replacementEvidence = deferred.callback.argumentAdapter?.kind === "regexp-replacement"
    ? selectedRustRegExpReplacementCallbackEvidence(
        request,
        deferred.callback.sourceArgumentIndex,
        deferred.callback.argumentAdapter.lane,
        context,
        options,
      )
    : undefined;
  if (deferred.callback.argumentAdapter !== undefined && replacementEvidence === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_REPLACEMENT_CALLBACK_CONTRACT_MISSING",
      "Selected RegExp replacement callback has no closed lane-specific argument-vector contract from exact callable evidence.",
    );
  }
  const parameterTemplates = replacementEvidence === undefined ? deferred.parameterCarriers
    : deferred.parameterCarriers.map((carrier, index) => index === deferred.callback.sourceArgumentIndex
      ? replacementEvidence.sourceCarrier : carrier);
  if (arguments_.length > deferred.parameterCarriers.length ||
    deferred.parameterCarriers.slice(arguments_.length).some(carrier => rustOptionElementCarrier(carrier) === undefined)) {
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
      : parameterTemplates[accumulatorIndex];
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
    const callbackTemplate = parameterTemplates[deferred.callback.sourceArgumentIndex];
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
  } else if (deferred.callback.shape === "map") {
    const callbackIndex = deferred.callback.sourceArgumentIndex;
    const argument = arguments_[callbackIndex];
    if (argument !== undefined) actual[callbackIndex] = resolveArgument(argument, parameterTemplates[callbackIndex]);
    const callback = rustCallbackProtocol(actual[callbackIndex]);
    if (callback !== undefined) {
      for (const [index, argument] of arguments_.entries()) {
        if (index === callbackIndex) continue;
        const template = parameterTemplates[index];
        actual[index] = resolveArgument(argument, template === undefined ? undefined : replaceRustInferCarrier(template, callback.result));
      }
    }
  } else {
    for (const [index, argument] of arguments_.entries()) {
      actual[index] = resolveArgument(
        argument,
        parameterTemplates[index],
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
    parameterCarriers: parameterTemplates,
    callback: deferred.callback,
  }, actual as TargetTypeRef[], (source, target) =>
    selectRustValueCarrierReconciliation(source, target, options.projectTypes, context.typeDefinitions).kind !== "incompatible");
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
  const callbackCarrier = parameterCarriers[deferred.callback.sourceArgumentIndex];
  const replacementCallback = replacementEvidence === undefined || callbackCarrier === undefined
    ? undefined
    : finalizeRustRegExpReplacementCallbackContract(replacementEvidence, callbackCarrier);
  if (replacementEvidence !== undefined && replacementCallback === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_REPLACEMENT_CALLBACK_CARRIER_CONFLICT",
      "Selected RegExp replacement callback carrier conflicts with its exact callable evidence.",
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
    ...(replacementCallback === undefined ? {} : { replacementCallback }),
  });
}

export function resolveRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackEffects: RustPreparedCallbackEffects,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const callbackFallible = callbackEffects.invocationEffects.localErrors || callbackEffects.invocationEffects.nativeErrors.length !== 0;
  let template = callbackFallibleTemplate(prepared, callbackEffects);
  if (prepared.replacementCallback !== undefined) {
    const target = applyRustRegExpReplacementCallbackConversion(
      template.target,
      prepared.callback.sourceArgumentIndex,
      prepared.parameterCarriers.length,
      prepared.replacementCallback,
      callbackFallible,
    );
    if (target === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_REGEXP_REPLACEMENT_CALLBACK_ABI_INVALID",
        "Selected RegExp replacement callback cannot attach its finalized conversion to the target operation form.",
      );
    }
    template = { ...template, target };
  }
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

export function mapRustSourceMarkerCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  markerName: SourceCallMarkerKind,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  if (markerName === "default-value" || markerName === "field") {
    return mapRustDefaultValueCall(request, provider, markerName, context, options);
  }
  if (markerName === "js-string") {
    if (provider.exportName === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_JS_STRING_MARKER_IDENTITY_INCOMPLETE",
        "The exact jsstr marker requires its selected provider export name.",
      );
    }
    const arguments_ = selectedCallArgumentNodes(request);
    if (arguments_.length !== 1) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_JS_STRING_MARKER_ARITY_INVALID",
        "The exact jsstr marker requires one selected native string argument.",
      );
    }
    return acceptSelectedCall(request, {
      kind: "provider-operation",
      operationId: "tsonic.rust.js.jsstr",
      operationKind: "method",
      target: {
        form: "call",
        path: "js_abi::js_string_from_utf8",
        argModes: ["value"],
      },
      parameterCarriers: [rustStringTargetType()],
      resultCarrier: rustJsStringTargetType(),
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    }, [rustStringTargetType()], context, options, {
      sourceName: provider.exportName,
      providerDeclaration: provider,
    });
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
  const flow = context.source.sourceFacts.getFact(request.source.call, flowStateFactKey);
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
  return acceptRustPolicy({
    targetFact: fact,
    selectedSignature: selectedRustCallSignature(request, {
      id: fact.operationId,
      sourceName: markerName,
      targetName: "marker",
      kind: "method",
      parameters: [{ name: "value", type: carrier, passingMode: "by-value" }],
      returnType: carrier,
      providerDeclaration: provider,
    }),
  }, evidence);
}

function mapRustDefaultValueCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  marker: "default-value" | "field",
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = selectedCallArgumentNodes(request);
  const sourceFact = marker === "field"
    ? context.source.sourceFacts.getFact(request.source.call, fieldFactKey)
    : context.source.sourceFacts.getFact(request.source.call, defaultValueFactKey);
  const signatureContext = rustSourceStorageSubjectContext(context, undefined);
  const resultCarrier = resolveRustTargetTypeRef(sourceFact?.type, signatureContext, options);
  const sourceTypeArguments = request.source.sourceSelectedMethodTypeArguments;
  const sourceParameters = rustSelectedCallTypeParameters(sourceTypeArguments ?? [], context);
  const targetTypeArguments = mapSelectedTargetTypeArguments(request, signatureContext, options);
  if (sourceArguments.length !== 0 || sourceFact === undefined || resultCarrier === undefined ||
    sourceTypeArguments?.length !== 1 || sourceParameters === undefined || sourceParameters.length !== 1 ||
    targetTypeArguments === undefined || targetTypeArguments.length !== 1 ||
    !rustTargetTypeRefEquals(targetTypeArguments[0], resultCarrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_DEFAULT_VALUE_EVIDENCE_NOT_PROVEN",
      "Native default initialization requires one exact source-core type fact, one matching selected type argument, no arguments, and one matching Rust result carrier.",
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
    sourceName: provider.exportName ?? marker,
    targetName: "Default::default",
    kind: "method",
    static: true,
    parameters: [],
    returnType: resultCarrier,
    genericParameters: [{
      kind: "type",
      sourceName: sourceTypeArguments[0]!.typeParameterName,
      targetIdentity: sourceParameters[0]!.identity,
    }],
    providerDeclaration: provider,
  };
  const selectedSignature = selectedRustCallSignature(request, member, {
    providerDeclaration: provider,
    targetGenericArguments: [{ kind: "type", type: targetTypeArguments[0]! }],
  });
  const evidence = [{ message: `rust selected source-core native default initialization (${marker})` }];
  return acceptRustPolicy({ selectedSignature, targetFact: fact, operation }, evidence);
}
