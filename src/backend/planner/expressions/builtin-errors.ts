import { Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  isRustProgramErrorCarrier,
  rustOptionTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustCurrentErrorBoundary, type RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { planExpressionBeforeValueProjections } from "./entry.js";
import { rustFlowReadProjectionFactKey } from "../../../analysis/facts/value-projections.js";
import { rustFlowReadProjectionMatches } from "../../../analysis/facts/flow-read-projections.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { planRustNonConsumingValue, planRustSharedReceiver } from "./typed-locations.js";
import { rustCarrierProvidesErrorObservation } from "../../../target-model/types/carriers/error-protocols.js";
import { effectiveMemberResultCarrier } from "./special.js";


export function planRustBuiltinErrorProperty(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-property" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const projection = receiverNode === undefined ? undefined : context.input.program.facts.getFact(receiverNode, rustFlowReadProjectionFactKey);
  const borrowedProgramError = projection?.kind === "builtin-error" && isRustProgramErrorCarrier(projection.sourceCarrier) &&
    rustTargetTypeRefEquals(projection.selectedCarrier, fact.receiverCarrier) &&
    rustFlowReadProjectionMatches(projection, context.input.program.projectTypes, context.input.program.typeDefinitions);
  const receiver = receiverNode === undefined ? undefined : borrowedProgramError
    ? planExpressionBeforeValueProjections(receiverNode, context, "value") : planExpression(receiverNode, context);
  const resultCarrier = fact.property === "stack"
    ? rustOptionTargetType(rustStringTargetType())
    : rustStringTargetType();
  const selectedResultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  if (receiverNode === undefined || receiver === undefined ||
    fact.accessMode === "write" ||
    !rustCarrierProvidesErrorObservation(fact.receiverCarrier, context.input.program.typeDefinitions) ||
    !rustTargetTypeRefEquals(fact.resultCarrier, resultCarrier) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(receiverNode, context), fact.receiverCarrier) ||
    selectedResultCarrier === undefined ||
    !requireExpressionCarrier(node, selectedResultCarrier, context, "rust.backend.builtin-error-property-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetProperty(node),
      fact.operationId, "property", selectedResultCarrier,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node), "rust.backend.builtin-error-property-evidence",
      "Builtin Error property reading conflicts with its finalized member or exact native carriers.",
    ));
    return undefined;
  }
  if (borrowedProgramError) {
    const boundary = rustCurrentErrorBoundary(context);
    if (boundary === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.builtin-error-boundary", "Builtin Error observation requires its exact native error domain."));
      return undefined;
    }
    const observed: RustExpr = { kind: "method-call", receiver: planRustNonConsumingValue(receiverNode, receiver, context), method: "source_error", args: [] };
    const borrowed: RustExpr = boundary.errorDomain === "runtime" ? observed
      : { kind: "method-call", receiver: observed, method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error observation" }] };
    const read: RustExpr = { kind: "call", path: `tsonic_rust_runtime::ErrorObject::error_${fact.property}`, args: [borrowed] };
    return fact.property === "stack" ? { kind: "method-call", receiver: read, method: "map", args: [{ kind: "path", path: "String::from" }] }
      : { kind: "owned-string-from-borrowed-str", expression: read };
  }
  const read: RustExpr = { kind: "call", path: `rt::ErrorObject::error_${fact.property}`,
    args: [planRustSharedReceiver(receiverNode, receiver, context)] };
  return fact.property === "stack" ? { kind: "method-call", receiver: read, method: "map",
    args: [{ kind: "path", path: "String::from" }] }
    : { kind: "owned-string-from-borrowed-str", expression: read };
}
