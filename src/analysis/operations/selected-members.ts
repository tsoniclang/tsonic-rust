import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustCheckedElementSelectionInput, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../policy/operations/contracts.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { rustCheckedElementRequestsEqual, rustCheckedPropertyRequestsEqual } from "./call-request-correspondence.js";
import { admitRustOperationSelection } from "./operation-admission.js";
import { resolveRustCheckedElementAccess } from "./provider/elements-and-iteration.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import { resolveRustCheckedPropertyAccess } from "./provider/properties.js";

export function selectRustCheckedPropertyAccess(
  request: RustCheckedPropertySelectionInput, context: RustOperationAnalysisContext, options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  return selectMember({ kind: "property", request }, context, options);
}

export function selectRustCheckedElementAccess(
  request: RustCheckedElementSelectionInput, context: RustOperationAnalysisContext, options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  return selectMember({ kind: "element", request }, context, options);
}

function selectMember(input:
  | { readonly kind: "property"; readonly request: RustCheckedPropertySelectionInput }
  | { readonly kind: "element"; readonly request: RustCheckedElementSelectionInput },
  context: RustOperationAnalysisContext, options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  context.records.assertOpen();
  const attempt = context.operationAttempts.get(input.request.expression);
  if (attempt !== undefined && attempt.kind !== "attempted") {
    const matches = input.kind === "property"
      ? attempt.kind === "property" && rustCheckedPropertyRequestsEqual(attempt.request, input.request)
      : attempt.kind === "element" && rustCheckedElementRequestsEqual(attempt.request, input.request);
    if (!matches || attempt.options !== options || attempt.kind === "checked-call") {
      failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust checked member request for one exact source subject.", input.request.expression);
    }
    return attempt.selection;
  }
  const selected = input.kind === "property"
    ? resolveRustCheckedPropertyAccess(input.request, context, options)
    : resolveRustCheckedElementAccess(input.request, context, options);
  const admitted = admitRustOperationSelection(input.request.expression, selected, context);
  if (admitted.kind === "accept" && context.records.selectedOperation.get(input.request.expression) !== undefined) {
    context.operationAttempts.set(input.request.expression, input.kind === "property"
      ? { kind: "property", request: input.request, options, selection: admitted }
      : { kind: "element", request: input.request, options, selection: admitted });
  }
  return admitted;
}
