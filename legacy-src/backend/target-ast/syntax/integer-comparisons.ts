import type { RustExpr } from "./nodes.js";

export function foldRustIntegerComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") return undefined;
  const leftValue = rustIntegerLiteralValue(left);
  const rightValue = rustIntegerLiteralValue(right);
  return leftValue === undefined || rightValue === undefined ? undefined : {
    kind: "bool-literal",
    value: operator === "==" ? leftValue === rightValue : leftValue !== rightValue,
  };
}

export function rustIntegerLiteralValue(expression: RustExpr): bigint | undefined {
  if (expression.kind !== "int-literal") return undefined;
  const selected = /^(-?(?:0|[1-9][0-9]*))(?:_?[iu](?:8|16|32|64|128|size))?$/u.exec(expression.text);
  return selected === null ? undefined : BigInt(selected[1]!);
}
