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
  context.records.selectedOperations.checked(request.source.call, selection);
  return selection;
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackFallible: boolean,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const selection = resolveRustPreparedCheckedCall(request, prepared, callbackFallible, context, options);
  context.records.selectedOperations.checked(request.source.call, selection);
  return selection;
}
