import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { rustStrictEqualityOperandCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustOptionEqualityContract } from "../../../target-model/operations/option-equality.js";
import { hasExactObjectKeys, isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustOptionCarrier, rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planExpressionBeforeOptionProjection, planExpressionBeforeValueProjections } from "./entry.js";
import { expressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planRustStringComparisonView } from "./string-comparison-views.js";

function operand(
  node: Node, later: Node | undefined, carrier: TargetTypeRef, borrowString: boolean, liftDepth: number, context: RustPlanContext,
): RustExpr | undefined {
  const value = isRustOptionCarrier(expressionCarrier(node, context))
    ? planExpressionBeforeValueProjections(node, context, "value")
    : planExpressionBeforeOptionProjection(node, context);
  if (value === undefined) return undefined;
  let selected: RustExpr | undefined = planRustNonConsumingValue(node, value, context);
  if (borrowString) selected = planRustStringComparisonView(node, selected, carrier, later, context);
  if (selected === undefined) return undefined;
  for (let depth = 0; depth < liftDepth; depth += 1) selected = { kind: "call", path: "Some", args: [selected] };
  return selected;
}

export function planRustOptionEquality(
  node: Node, fact: Extract<RustTargetOperationFact, { readonly kind: "option-equality" }>, context: RustPlanContext,
): RustExpr | undefined {
  const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
  const leftCarrier = rustStrictEqualityOperandCarrier(context.input.program.facts, leftNode);
  const rightCarrier = rustStrictEqualityOperandCarrier(context.input.program.facts, rightNode);
  const contract = rustOptionEqualityContract(leftCarrier, rightCarrier);
  const boolCarrier = rustSourcePrimitiveTargetType("bool");
  const operator = context.input.program.source.ast.operatorKindName(node);
  if (leftNode === undefined || rightNode === undefined || contract === undefined || !isClosedMetadata(fact) ||
    !hasExactObjectKeys(fact, ["kind", "operationId", "negated", "leftCarrier", "rightCarrier", "comparisonCarrier",
      "leftLiftDepth", "rightLiftDepth", "borrowString"]) || typeof fact.negated !== "boolean" ||
    operator !== (fact.negated ? "KindExclamationEqualsEqualsToken" : "KindEqualsEqualsEqualsToken") ||
    !rustTargetTypeRefEquals(leftCarrier, fact.leftCarrier) || !rustTargetTypeRefEquals(rightCarrier, fact.rightCarrier) ||
    !rustTargetTypeRefEquals(contract.comparisonCarrier, fact.comparisonCarrier) || contract.borrowString !== fact.borrowString ||
    contract.leftLiftDepth !== fact.leftLiftDepth || contract.rightLiftDepth !== fact.rightLiftDepth ||
    !requireExpressionCarrier(node, boolCarrier, context, "rust.backend.option-equality-carrier") ||
    !selectedOperationMatches(context.input.program.facts.getSelectedTargetOperator(node), fact.operationId,
      "operator", boolCarrier, fact.operationId)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.option-equality",
      "Option equality conflicts with its exact native operand carriers, borrowed view, presence depth or selected operation."));
    return undefined;
  }
  const left = operand(leftNode, rightNode, fact.leftCarrier, fact.borrowString, fact.leftLiftDepth, context);
  const right = operand(rightNode, undefined, fact.rightCarrier, fact.borrowString, fact.rightLiftDepth, context);
  return left === undefined || right === undefined ? undefined
    : { kind: "binary", operator: fact.negated ? "!=" : "==", left, right };
}
