import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { isRustBoolCarrier, isRustStringCarrier } from "../../../target-model/types/index.js";
import { negateRustBooleanExpression, rustBooleanLiteralComparison } from "../../target-ast/expressions.js";
import { effectivePlannedExpressionCarrier, rustPartialOrderingTest } from "./fundamentals.js";

export function planEmptyStringComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") {
    return undefined;
  }
  const emptyLiteral = (expression: RustExpr): boolean =>
    (expression.kind === "string-literal" || expression.kind === "str-literal") &&
    expression.value.length === 0;
  const selected = emptyLiteral(left)
    ? { expression: right, node: rightNode }
    : emptyLiteral(right)
      ? { expression: left, node: leftNode }
      : undefined;
  if (selected?.node === undefined ||
    !isRustStringCarrier(effectivePlannedExpressionCarrier(selected.node, context))) {
    return undefined;
  }
  const isEmpty: RustExpr = {
    kind: "method-call",
    receiver: selected.expression,
    method: "is_empty",
    args: [],
  };
  return operator === "=="
    ? isEmpty
    : negateRustBooleanExpression(isEmpty);
}

export function planRustRangeContainment(
  operator: string,
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (operator !== "&&" && operator !== "||") {
    return undefined;
  }
  const direct = planRustRangeComparisonPair(operator, left, right);
  if (direct !== undefined) {
    return direct;
  }
  if (left.kind === "binary" && left.operator === operator) {
    const trailing = planRustRangeComparisonPair(operator, left.right, right);
    if (trailing !== undefined) {
      return {
        kind: "binary",
        operator,
        left: left.left,
        right: trailing,
      };
    }
  }
  if (right.kind === "binary" && right.operator === operator) {
    const leading = planRustRangeComparisonPair(operator, left, right.left);
    if (leading !== undefined) {
      return {
        kind: "binary",
        operator,
        left: leading,
        right: right.right,
      };
    }
  }
  return undefined;
}

function planRustRangeComparisonPair(
  operator: "&&" | "||",
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (left.kind !== "binary" || right.kind !== "binary") {
    return undefined;
  }
  const inclusive = operator === "&&" &&
    (left.operator === ">=" || left.operator === "<=") &&
    (right.operator === ">=" || right.operator === "<=");
  const exclusive = operator === "||" &&
    (left.operator === ">" || left.operator === "<") &&
    (right.operator === ">" || right.operator === "<");
  if (!inclusive && !exclusive) {
    return undefined;
  }
  const first = comparisonSubjectAndBound(left, exclusive);
  const second = comparisonSubjectAndBound(right, exclusive);
  if (first === undefined || second === undefined ||
    first.subject.path !== second.subject.path ||
    !isRustNumericLiteral(first.bound) || !isRustNumericLiteral(second.bound)) {
    return undefined;
  }
  const lower = first.relationship === "lower" ? first.bound
    : second.relationship === "lower" ? second.bound
      : undefined;
  const upper = first.relationship === "upper" ? first.bound
    : second.relationship === "upper" ? second.bound
      : undefined;
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  if (exclusive && (!isRustIntegerLiteral(lower) || !isRustIntegerLiteral(upper))) {
    if (!isRustFloatLiteral(lower) || !isRustFloatLiteral(upper)) {
      return undefined;
    }
    return {
      kind: "binary",
      operator: "||",
      left: rustPartialOrderingTest(first.subject, lower, "==", "Less"),
      right: rustPartialOrderingTest(second.subject, upper, "==", "Greater"),
    };
  }
  const contains: RustExpr = {
    kind: "method-call",
    receiver: { kind: "range", start: lower, end: upper, inclusive: true },
    method: "contains",
    args: [{ kind: "reference", expr: first.subject }],
  };
  return inclusive ? contains : negateRustBooleanExpression(contains);
}

function comparisonSubjectAndBound(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  outsideRange: boolean,
): {
  readonly subject: Extract<RustExpr, { readonly kind: "path" }>;
  readonly bound: RustExpr;
  readonly relationship: "lower" | "upper";
} | undefined {
  if (expression.left.kind === "path" && isRustNumericLiteral(expression.right)) {
    const relationship = outsideRange
      ? expression.operator === "<" ? "lower"
        : expression.operator === ">" ? "upper"
          : undefined
      : expression.operator === ">=" ? "lower"
        : expression.operator === "<=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.left, bound: expression.right, relationship };
  }
  if (expression.right.kind === "path" && isRustNumericLiteral(expression.left)) {
    const relationship = outsideRange
      ? expression.operator === ">" ? "lower"
        : expression.operator === "<" ? "upper"
          : undefined
      : expression.operator === "<=" ? "lower"
        : expression.operator === ">=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.right, bound: expression.left, relationship };
  }
  return undefined;
}

function isRustNumericLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "float-literal" ||
    expression.kind === "unary" && expression.operator === "-" &&
      (expression.operand.kind === "int-literal" || expression.operand.kind === "float-literal");
}

function isRustIntegerLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "int-literal";
}

function isRustFloatLiteral(expression: RustExpr): boolean {
  return expression.kind === "float-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "float-literal";
}

export function planBooleanLiteralComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") {
    return undefined;
  }
  const otherNode = left.kind === "bool-literal" ? rightNode
    : right.kind === "bool-literal" ? leftNode : undefined;
  if (otherNode === undefined ||
    !isRustBoolCarrier(effectivePlannedExpressionCarrier(otherNode, context))) {
    return undefined;
  }
  return rustBooleanLiteralComparison(operator, left, right);
}
