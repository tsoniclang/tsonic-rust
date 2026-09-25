import type { RustExpr } from "../nodes.js";
import { rustExpressionChildren } from "./source-usage.js";

export function rustExpressionExitsCallable(expression: RustExpr): boolean {
  if (expression.kind === "closure" || expression.kind === "closure-block") return false;
  if (expression.kind === "return-expression" || expression.kind === "try" && expression.nativeReturn === true) return true;
  return rustExpressionChildren(expression).some(rustExpressionExitsCallable);
}
