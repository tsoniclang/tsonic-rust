import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../policy/operations/contracts.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import { resolveRustCheckedCall } from "./provider/calls/selection.js";
import { resolveRustPreparedCheckedCall, type RustPreparedDeferredCheckedCall } from "./provider/calls/deferred.js";

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const selection = resolveRustCheckedCall(request, context, options);
  recordCheckedCallSelection(request, selection, context);
  return selection;
}

function recordCheckedCallSelection(
  request: RustCheckedCallSelectionInput,
  selection: RustPolicySelection<RustCheckedCallSelectionResult>,
  context: RustOperationAnalysisContext,
): void {
  if (selection.kind === "accept" && selection.value.kind !== "source" &&
    selection.value.kind !== "deferred-callback" && selection.value.sourceGuard !== undefined) {
    context.records.runtimeCarriers.selected(selection.value.sourceGuard.guard,
      selection.value.sourceGuard.sourceGuardCarrier);
  }
  context.records.targetOperations.checked(request.source.call, selection);
  context.records.selectedCalls.checked(request, selection);
  context.records.selectedOperations.checked(request.source.call, selection);
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackFallible: boolean,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const selection = resolveRustPreparedCheckedCall(request, prepared, callbackFallible, context, options);
  recordCheckedCallSelection(request, selection, context);
  return selection;
}
