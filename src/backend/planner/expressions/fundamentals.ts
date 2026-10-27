import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import { negateRustBooleanExpression } from "../../target-ast/syntax/expressions.js";
import { rustNegatedFloatOrdering } from "../../target-ast/syntax/comparisons.js";
import { isRustIntegerCarrier } from "../../../target-model/types/carriers/primitives.js";
import { isFloatCarrier } from "../types/carrier-syntax.js";

export function expressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ?? context.input.program.records.valueRead.get(node)?.source;
}

export function effectivePlannedExpressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ?? context.input.program.records.valueRead.get(node)?.value;
}

/**
 * Negates a planned condition. An ordered comparison of two integers inverts its operator; of two floats it becomes the
 * NaN-correct partial ordering test; anything else takes the syntax-only boolean negation.
 */
export function negateRustPlannedBooleanExpression(sourceExpression: Node | undefined, planned: RustExpr, context: RustPlanContext): RustExpr {
  const { ast } = context.input.program.source;
  let selected = sourceExpression;
  while (selected !== undefined && (ast.is.IsParenthesizedExpression(selected) || ast.is.IsSatisfiesExpression(selected) ||
    ast.is.IsNonNullExpression(selected) || ast.is.IsAsExpression(selected) || ast.kindName(selected) === "KindTypeAssertionExpression")) {
    selected = Node_Expression(ast, selected);
  }
  if (selected === undefined || !ast.is.IsBinaryExpression(selected) || planned.kind !== "binary" ||
    (planned.operator !== "<" && planned.operator !== "<=" && planned.operator !== ">" && planned.operator !== ">=")) {
    return negateRustBooleanExpression(planned);
  }
  const left = BinaryExpression_Left(ast, selected);
  const right = BinaryExpression_Right(ast, selected);
  const leftCarrier = left === undefined ? undefined : expressionCarrier(left, context);
  const rightCarrier = right === undefined ? undefined : expressionCarrier(right, context);
  const inverse = planned.operator === "<" ? ">=" : planned.operator === "<=" ? ">" : planned.operator === ">" ? "<=" : "<";
  if (isRustIntegerCarrier(leftCarrier) && isRustIntegerCarrier(rightCarrier)) return { ...planned, operator: inverse };
  if (isFloatCarrier(leftCarrier) && isFloatCarrier(rightCarrier)) {
    return rustNegatedFloatOrdering(planned.left, planned.right, planned.operator);
  }
  return negateRustBooleanExpression(planned);
}

export function rustOperationFact(node: Node, context: RustPlanContext): RustTargetOperationFact | undefined {
  return context.input.program.records.targetOperation.get(node);
}
