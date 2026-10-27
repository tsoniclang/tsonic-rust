import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../policy/model/contracts.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import type { RustOperationsProviderOptions } from "./members/model.js";
import { resolveRustCheckedCall } from "./members/calls/selection.js";
import { resolveRustPreparedCheckedCall } from "./members/calls/deferred.js";
import { type RustPreparedDeferredCheckedCall } from "../../target-model/records/callables/deferred-callbacks.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustCheckedCallRequestsEqual } from "./call-request-correspondence.js";
import { admitRustOperationSelection } from "./operation-admission.js";
import { rustSelectedTargetSignatureEquals } from "../../target-model/types/selected-call-equality.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { RustOperationAttempt } from "../program/operation-attempts.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustPreparedCallbackEffects } from "../../policy/operations/members/deferred-callbacks.js";
import { mergeRustErrorEffects, rustErrorEffectsEqual } from "../errors/error-effects.js";

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  context.records.assertOpen();
  const completed = completedCall(request, context, options);
  if (completed !== undefined) return completed.selection;
  const selection = resolveRustCheckedCall(request, context, options);
  return recordCheckedCallSelection(request, selection, context, options);
}

function recordCheckedCallSelection(
  request: RustCheckedCallSelectionInput,
  selection: RustPolicySelection<RustCheckedCallSelectionResult>,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  prepared?: { readonly value: RustPreparedDeferredCheckedCall; readonly callbackEffects: RustPreparedCallbackEffects },
): RustPolicySelection<RustCheckedCallSelectionResult> {
  if (selection.kind !== "accept" || selection.value.kind === "source" || selection.value.kind === "deferred-callback") {
    return admitRustOperationSelection(request.source.call, selection, context);
  }
  const value = selection.value;
  const hasSelectedSignature = value.targetFact?.kind !== "flow-marker";
  if (hasSelectedSignature) requireRustRecord(context.requiredRecords, "selectedCall", request.source.call,
    "checked call", "recordCheckedCallSelection");
  const existing = hasSelectedSignature ? context.records.selectedCall.get(request.source.call) : undefined;
  if (existing !== undefined && !rustSelectedTargetSignatureEquals(existing, value.selectedSignature)) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.selectedCall' for one exact source subject.", request.source.call);
  }
  const guard = value.sourceGuard;
  if (guard !== undefined) requireRustRecord(context.requiredRecords, "runtimeCarrier", guard.guard,
    "checked call source guard", "recordCheckedCallSelection");
  const existingGuard = guard === undefined ? undefined : context.records.runtimeCarrier.get(guard.guard);
  if (guard !== undefined && existingGuard !== undefined && !rustTargetTypeRefEquals(existingGuard.carrier, guard.sourceGuardCarrier)) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.runtimeCarrier' for one exact source subject.", request.source.call);
  }
  const admitted = admitRustOperationSelection(request.source.call, selection, context);
  if (admitted.kind !== "accept" || admitted.value.kind === "source" || admitted.value.kind === "deferred-callback") return admitted;
  if (guard !== undefined && context.records.runtimeCarriers.source(guard.guard, guard.sourceGuardCarrier) !== undefined) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.runtimeCarrier' for one exact source subject.", request.source.call);
  }
  if (!hasSelectedSignature) return admitted;
  if (existing === undefined) context.records.selectedCalls.checked(request, admitted);
  const canonical = existing === undefined || existing === admitted.value.selectedSignature ? admitted
    : { ...admitted, value: { ...admitted.value, selectedSignature: existing } };
  if (canonical.value.operation !== undefined && context.records.selectedOperation.get(request.source.call) === undefined) return canonical;
  context.operationAttempts.set(request.source.call, { kind: "checked-call", request, options, selection: canonical,
    ...(prepared === undefined ? {} : { prepared }),
  });
  return canonical;
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackEffects: RustPreparedCallbackEffects,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  context.records.assertOpen();
  if (callbackEffects === null || typeof callbackEffects !== "object" || callbackEffects.invocationOwner === undefined ||
    callbackEffects.invocationEffects === undefined || callbackEffects.implementationEffects === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "A prepared callback requires its complete invocation and implementation effect contract.", request.source.call);
  const invocationEffects = mergeRustErrorEffects([callbackEffects.invocationEffects]);
  const implementationEffects = mergeRustErrorEffects([callbackEffects.implementationEffects]);
  if (invocationEffects === undefined || implementationEffects === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "A prepared callback requires consistent exact native error effects.", request.source.call);
  const selectedEffects = Object.freeze({ invocationOwner: callbackEffects.invocationOwner, invocationEffects, implementationEffects });
  const completed = completedCall(request, context, options);
  if (completed !== undefined) {
    if (completed.prepared === undefined ||
      completed.prepared.callbackEffects.invocationOwner !== callbackEffects.invocationOwner ||
      !rustErrorEffectsEqual(completed.prepared.callbackEffects.invocationEffects, invocationEffects) ||
      !rustErrorEffectsEqual(completed.prepared.callbackEffects.implementationEffects, implementationEffects) ||
      !preparedCallsEqual(completed.prepared.value, prepared)) {
      failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust completed prepared call for one exact source subject.", request.source.call);
    }
    return completed.selection;
  }
  const selection = resolveRustPreparedCheckedCall(request, prepared, selectedEffects, context, options);
  return recordCheckedCallSelection(request, selection, context, options, { value: prepared, callbackEffects: selectedEffects });
}

function completedCall(request: RustCheckedCallSelectionInput, context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions): Extract<RustOperationAttempt, { readonly kind: "checked-call" }> | undefined {
  const attempt = context.operationAttempts.get(request.source.call);
  if (attempt === undefined || attempt.kind === "attempted") return undefined;
  if (attempt.kind !== "checked-call" || attempt.options !== options || !rustCheckedCallRequestsEqual(attempt.request, request)) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.selectedCall' for one exact source subject.", request.source.call);
  }
  return attempt;
}

function preparedCallsEqual(left: RustPreparedDeferredCheckedCall, right: RustPreparedDeferredCheckedCall): boolean {
  return left.sourceName === right.sourceName && closedMetadataEquals(left.providerDeclaration, right.providerDeclaration) &&
    closedMetadataEquals(left.callback, right.callback) && closedMetadataEquals(left.template, right.template) &&
    left.parameterCarriers.length === right.parameterCarriers.length &&
    left.parameterCarriers.every((carrier, index) => rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    (left.replacementCallback === undefined || right.replacementCallback === undefined
      ? left.replacementCallback === right.replacementCallback
      : left.replacementCallback.lane === right.replacementCallback.lane &&
        rustTargetTypeRefEquals(left.replacementCallback.sourceCarrier, right.replacementCallback.sourceCarrier) &&
        rustTargetTypeRefEquals(left.replacementCallback.targetCarrier, right.replacementCallback.targetCarrier) &&
        closedMetadataEquals(left.replacementCallback.projections, right.replacementCallback.projections));
}
