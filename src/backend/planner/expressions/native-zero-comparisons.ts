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
  const zero = (expression: RustExpr): boolean => expression.kind === "int-literal" &&
    /^0(?:[iu](?:8|16|32|64|128|size))?$/u.test(expression.text);
  const selected = zero(right) ? { expression: left, node: leftNode, operator }
    : zero(left) && reversedComparisons[operator] !== undefined
      ? { expression: right, node: rightNode, operator: reversedComparisons[operator]! }
      : undefined;
  if (selected === undefined) return undefined;
  const carrier = effectivePlannedExpressionCarrier(selected.node, context);
  if (!isRustIntegerCarrier(carrier) || isRustSignedNumericCarrier(carrier)) return undefined;
  if (selected.operator === "<" || selected.operator === ">=") {
    const value: RustExpr = { kind: "bool-literal", value: selected.operator === ">=" };
    return selected.expression.kind === "path" || selected.expression.kind === "int-literal"
      ? value
      : { kind: "evaluate-then", effect: selected.expression, discard: "value", value };
  }
  const operation = rustOperationFact(selected.node, context);
  const expression = selected.expression;
  if (operation?.kind !== "provider-operation") return undefined;
  const { abi } = operation;
  if (abi.operationKind !== "property" || abi.effects.invocation !== "infallible" || abi.effects.evaluation !== "pure" ||
    abi.result.kind !== "sync" || abi.result.conversion.kind !== "identity" ||
    abi.target.form !== "receiver-method" || abi.target.emptyTestMethod === undefined ||
    abi.sourceReceiver.kind !== "receiver" ||
    expression.kind !== "method-call" || expression.method !== abi.target.name || expression.args.length !== 0) return undefined;
  const empty = selected.operator === "==" || selected.operator === "<=";
  const nonempty = selected.operator === "!=" || selected.operator === ">";
  if (!empty && !nonempty) return undefined;
  const check: RustExpr = { kind: "method-call", receiver: expression.receiver, method: abi.target.emptyTestMethod, args: [] };
  return empty ? check : negateRustBooleanExpression(check);
}
