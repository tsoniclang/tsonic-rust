import type { RustExpr } from "../nodes.js";
import { rustExpressionChildren } from "./expression-children.js";

export function rustExpressionMayExitCallable(expression: RustExpr): boolean {
  if (expression.kind === "closure" || expression.kind === "closure-block") return false;
  if (expression.kind === "macro-invocation" || expression.kind === "return-expression" ||
    expression.kind === "try" && expression.nativeReturn === true) return true;
  return rustExpressionChildren(expression).some(rustExpressionMayExitCallable);
}
