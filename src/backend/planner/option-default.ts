import type { RustExpr } from "../rust-ast/nodes.js";

export function rustOptionDefaultValue(
  option: RustExpr,
  fallback: RustExpr,
): RustExpr {
  const eager = rustDefaultMayEvaluateEagerly(fallback);
  return {
    kind: "method-call",
    receiver: option,
    method: eager ? "unwrap_or" : "unwrap_or_else",
    args: eager
      ? [fallback]
      : [{ kind: "closure", params: [], body: fallback }],
  };
}

function rustDefaultMayEvaluateEagerly(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
      return true;
    case "unary":
      return rustDefaultMayEvaluateEagerly(expression.operand);
    case "numeric-cast":
      return rustDefaultMayEvaluateEagerly(expression.expression);
    default:
      return false;
  }
}
