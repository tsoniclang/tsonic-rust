import { rustCompactInitializerWidth } from "../formatting.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function initializerPrefersReferencedNestedBreak(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" | "invoke" }>,
  flat: string,
  layoutRegion: "default" | "initializer-continuation" | "logical-chain-operand" |
    "vertical-call-argument" | "block-arm",
): boolean {
  if (layoutRegion !== "initializer-continuation" ||
    flat.length <= rustCompactInitializerWidth || expression.args.length !== 1) {
    return false;
  }
  const argument = expression.args[0];
  if (argument?.kind !== "reference") {
    return false;
  }
  const nested = argument.expr;
  if (nested.kind !== "call" && nested.kind !== "associated-call" &&
    nested.kind !== "invoke" && nested.kind !== "method-call") {
    return false;
  }
  return nested.args.some((nestedArgument) =>
    nestedArgument.kind === "vec-literal" || nestedArgument.kind === "slice-literal" ||
    nestedArgument.kind === "tuple-literal");
}
