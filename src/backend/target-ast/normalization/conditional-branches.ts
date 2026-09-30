import type { RustExpr } from "../nodes.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { negateRustBooleanExpression } from "../expressions.js";

export function simplifyRustBooleanConditional(
  condition: RustExpr,
  whenTrue: RustExpr,
  whenFalse: RustExpr,
): RustExpr | undefined {
  if (whenTrue.kind !== "bool-literal" || whenFalse.kind !== "bool-literal") return undefined;
  if (whenTrue.value === whenFalse.value) {
    return { kind: "evaluate-then", effect: condition, discard: "value", value: whenTrue };
  }
  return whenTrue.value ? condition : negateRustBooleanExpression(condition);
}

export function mergeRustAdjacentConditionalBranches(
  condition: RustExpr,
  whenTrue: RustExpr,
  whenFalse: RustExpr,
): RustExpr | undefined {
  if (whenFalse.kind !== "conditional" || !conditionHasNoTemporaries(condition) ||
    !conditionHasNoTemporaries(whenFalse.condition) || !closedMetadataEquals(whenTrue, whenFalse.whenTrue)) return undefined;
  return {
    kind: "conditional",
    condition: { kind: "binary", operator: "||", left: condition, right: whenFalse.condition },
    whenTrue,
    whenFalse: whenFalse.whenFalse,
  };
}

function conditionHasNoTemporaries(expression: RustExpr): boolean {
  if (expression.kind === "path" || expression.kind === "bool-literal") return true;
  if (expression.kind !== "binary") return false;
  if (expression.operator === "&&" || expression.operator === "||") {
    return conditionHasNoTemporaries(expression.left) && conditionHasNoTemporaries(expression.right);
  }
  const operand = (value: RustExpr): boolean => value.kind === "path" || value.kind === "str-literal" ||
    value.kind === "int-literal" || value.kind === "float-literal" || value.kind === "char-literal" || value.kind === "bool-literal";
  return ["==", "!=", "<", ">", "<=", ">="].includes(expression.operator) && operand(expression.left) && operand(expression.right);
}
