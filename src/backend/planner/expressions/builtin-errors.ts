import { BinaryExpression_Left, Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  isRustJsValueCarrier,
  isRustProgramErrorCarrier,
  rustJsErrorTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { planExpressionBeforeValueProjections } from "./entry.js";
import { rustFlowReadProjectionFactKey } from "../../../analysis/facts/value-projections.js";
import { rustFlowReadProjectionMatches } from "../../../analysis/facts/flow-read-projections.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { isRustSourceErrorCarrier } from "../../../target-model/types/carriers/source-error.js";

export function planRustBuiltinErrorTypeTest(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-type-test" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const operandNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
  const validSource = fact.lowering === "native-error"
    ? rustTargetTypeRefEquals(fact.sourceCarrier, rustJsErrorTargetType())
    : fact.lowering === "program-error" ? isRustProgramErrorCarrier(fact.sourceCarrier) || isRustSourceErrorCarrier(fact.sourceCarrier)
    : isRustJsValueCarrier(fact.sourceCarrier);
  if (operandNode === undefined || operand === undefined || !validSource ||
    !rustTargetTypeRefEquals(fact.resultCarrier, rustSourcePrimitiveTargetType("bool")) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(operandNode, context), fact.sourceCarrier) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.builtin-error-test-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId, "operator", fact.resultCarrier, "builtin-error-type-test",
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node), "rust.backend.builtin-error-test-evidence",
      "Builtin Error testing conflicts with its finalized source selection or closed native carrier.",
    ));
    return undefined;
  }
  const receiver = planRustNonConsumingValue(operandNode, operand, context);
  if (fact.errorKind === "any") {
    return fact.lowering !== "native-error"
      ? { kind: "method-call", receiver, method: "is_error", args: [] }
      : { kind: "evaluate-then", effect: receiver, discard: "value", value: { kind: "bool-literal", value: true } };
  }
  context.usedAliases?.add("rt");
  const errorKind: RustExpr = { kind: "path", path: `rt::JsErrorKind::${fact.errorKind}` };
  return fact.lowering !== "native-error"
    ? { kind: "method-call", receiver, method: "is_error_kind", args: [errorKind] }
    : {
        kind: "binary",
        left: { kind: "method-call", receiver, method: "kind", args: [] },
        operator: "==",
        right: errorKind,
      };
}

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
  if (receiverNode === undefined || receiver === undefined ||
    (!rustTargetTypeRefEquals(fact.receiverCarrier, rustJsErrorTargetType()) && !isRustSourceErrorCarrier(fact.receiverCarrier)) ||
    !rustTargetTypeRefEquals(fact.resultCarrier, resultCarrier) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(receiverNode, context), fact.receiverCarrier) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.builtin-error-property-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetProperty(node),
      fact.operationId, "property", fact.resultCarrier,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node), "rust.backend.builtin-error-property-evidence",
      "Builtin Error property reading conflicts with its finalized member or exact native carriers.",
    ));
    return undefined;
  }
  if (borrowedProgramError) {
    const borrowed: RustExpr = { kind: "method-call", receiver: {
      kind: "method-call", receiver: planRustNonConsumingValue(receiverNode, receiver, context), method: "source_error", args: [],
    }, method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error observation" }] };
    const read: RustExpr = { kind: "call", path: `tsonic_rust_runtime::ErrorObject::error_${fact.property}`, args: [borrowed] };
    return fact.property === "stack" ? read : { kind: "owned-string-from-borrowed-str", expression: read };
  }
  if (fact.property === "stack") {
    return {
      kind: "method-call",
      receiver: planRustNonConsumingValue(receiverNode, receiver, context),
      method: "stack",
      args: [],
    };
  }
  const read: RustExpr = {
    kind: "method-call",
    receiver: planRustNonConsumingValue(receiverNode, receiver, context),
    method: fact.property === "message" ? "message" : isRustSourceErrorCarrier(fact.receiverCarrier) ? "name" : "kind",
    args: [],
  };
  return {
    kind: "owned-string-from-borrowed-str",
    expression: fact.property === "message" || isRustSourceErrorCarrier(fact.receiverCarrier)
      ? read
      : { kind: "method-call", receiver: read, method: "as_str", args: [] },
  };
}
