import { BinaryExpression_Left, Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  isRustJsValueCarrier,
  rustJsErrorTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { planRustNonConsumingValue } from "./typed-locations.js";

export function planRustBuiltinErrorTypeTest(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-type-test" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const operandNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const operand = operandNode === undefined ? undefined : planExpression(operandNode, context);
  const validSource = fact.lowering === "native-error"
    ? rustTargetTypeRefEquals(fact.sourceCarrier, rustJsErrorTargetType())
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
    return fact.lowering === "closed-value"
      ? { kind: "method-call", receiver, method: "is_error", args: [] }
      : { kind: "evaluate-then", effect: receiver, discard: "value", value: { kind: "bool-literal", value: true } };
  }
  context.usedAliases?.add("rt");
  const errorKind: RustExpr = { kind: "path", path: `rt::JsErrorKind::${fact.errorKind}` };
  return fact.lowering === "closed-value"
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
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const resultCarrier = fact.property === "stack"
    ? rustOptionTargetType(rustStringTargetType())
    : rustStringTargetType();
  if (receiverNode === undefined || receiver === undefined ||
    !rustTargetTypeRefEquals(fact.receiverCarrier, rustJsErrorTargetType()) ||
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
    method: fact.property === "message" ? "message" : "kind",
    args: [],
  };
  return {
    kind: "owned-string-from-borrowed-str",
    expression: fact.property === "message"
      ? read
      : { kind: "method-call", receiver: read, method: "as_str", args: [] },
  };
}
