import { rustNestedCallWidth } from "../formatting.js";
import { renderedFits } from "../patterns.js";
import { indentText } from "../types.js";
import { printRustAssociatedCallTarget, printRustDirectCallTarget } from "./callable.js";
import { printFittedCall } from "./calls.js";
import { printRustAssociatedOwner } from "./chains.js";
import { printRustExpr } from "./core.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function printFittedUnaryInvocation(
  expression: Extract<RustExpr, { readonly kind: "unary" }>,
  depth: number,
  column: number,
): string | undefined {
  const operand = expression.operand;
  if (operand.kind !== "call" && operand.kind !== "associated-call") {
    return undefined;
  }
  if (printRustExpr(operand).length <= rustNestedCallWidth) {
    return undefined;
  }
  const callable = operand.kind === "call"
    ? printRustDirectCallTarget(operand)
    : printRustAssociatedCallTarget(operand, printRustAssociatedOwner(operand.owner));
  const argumentIndent = indentText(depth + 1);
  const flatArguments = operand.args.map(printRustExpr);
  if (flatArguments.every((argument) =>
    !argument.includes("\n") && renderedFits(`${argument},`, argumentIndent.length))) {
    return [
      `${expression.operator}${callable}(`,
      ...flatArguments.map((argument) => `${argumentIndent}${argument},`),
      `${indentText(depth)})`,
    ].join("\n");
  }
  return `${expression.operator}${printFittedCall(
    callable,
    operand.args,
    depth,
    column + expression.operator.length,
    true,
  )}`;
}
