import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";
import { appendToLastLine, renderedFits } from "../patterns.js";
import { printFittedCall } from "./calls.js";
import { printRustExpr } from "./core.js";
import { rustFormatArgumentIsAtomic } from "./inspection.js";
import { printBinaryOperand } from "./precedence.js";

export function printExpandedBinaryLeftCall(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
  callable: string,
  operator: string,
  right: RustExpr,
  depth: number,
  column: number,
  preserveOperatorAttachment: boolean,
  prefersExpansion: boolean,
): string | undefined {
  if (expression.args.length <= 1 ||
    rustExpressionContainsStatementBlock(expression)) {
    return undefined;
  }
  const flatLeft = printRustExpr(expression);
  const leftRequiresExpansion = binaryCallAllowsArgumentExpansion(expression) &&
    (prefersExpansion || !renderedFits(flatLeft, column));
  if (!leftRequiresExpansion && !preserveOperatorAttachment) {
    return undefined;
  }
  const renderedRight = printBinaryOperand(right, operator, true);
  const candidate = printFittedCall(
    callable,
    expression.args,
    depth,
    column,
    true,
    false,
    depth,
    preserveOperatorAttachment
      ? {
          trailingContinuationWidth: ` ${operator} ${renderedRight}`.length,
        }
      : undefined,
  );
  if (leftRequiresExpansion) {
    return candidate;
  }
  const trailing = expression.args[expression.args.length - 1];
  if (trailing?.kind !== "closure" || candidate.includes("\n") === false ||
    renderedRight.includes("\n") ||
    renderedFits(`${flatLeft} ${operator} ${renderedRight}`, column)) {
    return undefined;
  }
  const joined = appendToLastLine(candidate, ` ${operator} ${renderedRight}`);
  return renderedFits(joined, column) ? candidate : undefined;
}

function binaryCallAllowsArgumentExpansion(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): boolean {
  const trailing = expression.args[expression.args.length - 1];
  return trailing?.kind !== "closure-block" &&
    (trailing?.kind !== "closure" || rustFormatArgumentIsAtomic(trailing.body));
}
