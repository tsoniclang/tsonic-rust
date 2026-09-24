import type { Node } from "@tsonic/tsts";
import {
  isRustIntegerCarrier,
  isRustSignedNumericCarrier,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { negateRustBooleanExpression } from "../../target-ast/expressions.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { effectivePlannedExpressionCarrier, rustOperationFact } from "./fundamentals.js";

const reversedComparisons: Readonly<Record<string, string>> = {
  "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=",
};

export function planRustNativeZeroComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node,
  rightNode: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const boundary = (expression: RustExpr): string | undefined => expression.kind === "int-literal"
    ? /^([01])(?:[iu](?:8|16|32|64|128|size))?$/u.exec(expression.text)?.[1]
    : undefined;
  const rightBoundary = boundary(right);
  const leftBoundary = boundary(left);
  const selected = rightBoundary !== undefined ? { expression: left, node: leftNode, operator, boundary: rightBoundary }
    : leftBoundary !== undefined && reversedComparisons[operator] !== undefined
      ? { expression: right, node: rightNode, operator: reversedComparisons[operator]!, boundary: leftBoundary }
      : undefined;
  if (selected === undefined) return undefined;
  const carrier = effectivePlannedExpressionCarrier(selected.node, context);
  if (!isRustIntegerCarrier(carrier) || isRustSignedNumericCarrier(carrier)) return undefined;
  const normalizedOperator = selected.boundary === "0" ? selected.operator
    : selected.operator === "<" ? "==" : selected.operator === ">=" ? "!=" : undefined;
  if (normalizedOperator === undefined) return undefined;
  if (normalizedOperator === "<" || normalizedOperator === ">=") {
    const value: RustExpr = { kind: "bool-literal", value: normalizedOperator === ">=" };
    return selected.expression.kind === "int-literal"
      ? value
      : { kind: "evaluate-then", effect: selected.expression, discard: "value", value };
  }
  const operation = rustOperationFact(selected.node, context);
  const expression = selected.expression;
  const comparisonOperator = normalizedOperator === "<=" || normalizedOperator === "==" ? "=="
    : normalizedOperator === ">" || normalizedOperator === "!=" ? "!=" : undefined;
  if (comparisonOperator === undefined) return undefined;
  const comparison: RustExpr | undefined = selected.boundary === "1" || comparisonOperator !== selected.operator
    ? { kind: "binary", operator: comparisonOperator, left: expression, right: { kind: "int-literal", text: "0" } }
    : undefined;
  if (operation?.kind !== "provider-operation") return comparison;
  const { abi } = operation;
  if (abi.operationKind !== "property" || abi.effects.invocation !== "infallible" || abi.effects.evaluation !== "pure" ||
    abi.result.kind !== "sync" || abi.result.conversion.kind !== "identity" ||
    abi.target.form !== "receiver-method" || abi.target.emptyTestMethod === undefined ||
    abi.sourceReceiver.kind !== "receiver" ||
    expression.kind !== "method-call" || expression.method !== abi.target.name || expression.args.length !== 0) return comparison;
  const empty = comparisonOperator === "==";
  const nonempty = comparisonOperator === "!=";
  if (!empty && !nonempty) return undefined;
  const check: RustExpr = { kind: "method-call", receiver: expression.receiver, method: abi.target.emptyTestMethod, args: [] };
  return empty ? check : negateRustBooleanExpression(check);
}
