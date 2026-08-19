import { appendToLastLine, firstLine, renderedFits } from "../patterns.js";
import { indentText } from "../types.js";
import { rustInlineFormatArgumentWidth, rustNestedCallWidth } from "../formatting.js";
import { printRustAssociatedCallOwner } from "./blocks.js";
import { printFittedCall } from "./calls.js";
import { printRustCallTypeArguments } from "./chains.js";
import { printRustClosureParams } from "./closure-params.js";
import { printRustExpr, rustExpressionContainsPreferredVerticalMethodChain } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustExpressionContainsExpandedStructLiteral } from "./inspection.js";
import { printOperand, RustPrecedence } from "./precedence.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/rust-ast/expressions.js";
import type { RustExpr } from "../../../backend/rust-ast/nodes.js";

export function printRustFormatArgument(
  expression: RustExpr,
  depth: number,
  column: number,
): string {
  const nestedClosureBody = printNestedFormatArgumentClosureBody(
    expression,
    depth,
    column,
  );
  if (nestedClosureBody !== undefined) {
    return nestedClosureBody;
  }
  if ((expression.kind === "call" || expression.kind === "associated-call") &&
    expression.args.length === 1) {
    const flat = printRustExpr(expression);
    if (flat.length < rustInlineFormatArgumentWidth * 2 &&
      !flat.includes("\n") && renderedFits(`${flat},`, column) &&
      !rustExpressionContainsStatementBlock(expression) &&
      !rustExpressionContainsPreferredVerticalMethodChain(expression) &&
      !rustExpressionContainsExpandedStructLiteral(expression)) {
      return flat;
    }
    const argument = expression.args[0]!;
    const callable = expression.kind === "call"
      ? expression.path
      : `${printRustAssociatedCallOwner(expression)}::${expression.method}`;
    const prefix = `${callable}(`;
    const borrowedNested = printBorrowedNestedRustFormatArgument(
      callable,
      argument,
      depth,
      column,
    );
    if (borrowedNested !== undefined) {
      return borrowedNested;
    }
    const renderedArgument = printRustExprFitted(
      argument,
      depth,
      column + prefix.length,
    );
    if (renderedArgument.includes("\n")) {
      if (argument.kind === "reference" &&
        argument.expr.kind !== "block" && argument.expr.kind !== "evaluate-then" &&
        rustExpressionContainsStatementBlock(argument)) {
        return printFittedCall(callable, [argument], depth, column, true);
      }
      const attached = appendToLastLine(`${prefix}${renderedArgument}`, ",)");
      if (firstLine(attached).length <= rustNestedCallWidth &&
        (renderedFits(attached, column) || rustExpressionContainsStatementBlock(argument))) {
        return attached;
      }
      return printFittedCall(callable, [argument], depth, column, true);
    }
  }
  return printRustExprFitted(expression, depth, column);
}

function printNestedFormatArgumentClosureBody(
  expression: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  const invocation = rustInvocationParts(expression);
  const trailingClosure = invocation?.arguments[invocation.arguments.length - 1];
  if (invocation === undefined || invocation.arguments.length < 2 ||
    trailingClosure?.kind !== "closure") {
    return undefined;
  }
  const flat = printRustExpr(expression);
  if (flat.includes("\n") || flat.length < rustInlineFormatArgumentWidth * 2 ||
    !renderedFits(`${flat},`, column)) {
    return undefined;
  }
  const bodyInvocation = rustInvocationParts(trailingClosure.body);
  const bodyArgument = bodyInvocation?.arguments[0];
  if (bodyInvocation === undefined || bodyInvocation.arguments.length !== 1 ||
    bodyArgument === undefined || rustExpressionContainsStatementBlock(bodyArgument) ||
    rustExpressionContainsExpandedStructLiteral(bodyArgument) ||
    rustExpressionContainsPreferredVerticalMethodChain(bodyArgument)) {
    return undefined;
  }
  const preceding = invocation.arguments.slice(0, -1).map(printRustExpr);
  if (preceding.some((argument) => argument.includes("\n"))) {
    return undefined;
  }
  const closurePrefix = `${trailingClosure.move === true ? "move " : ""}|${printRustClosureParams(trailingClosure.params)}| `;
  const opening = `${invocation.callable}(${preceding.join(", ")}, ${closurePrefix}${bodyInvocation.callable}(`;
  const argumentIndent = indentText(depth + 1);
  if (!renderedFits(opening, column)) {
    return undefined;
  }
  const renderedArgument = printRustExprFitted(
    bodyArgument,
    depth + 1,
    argumentIndent.length,
  );
  if (!renderedFits(renderedArgument, argumentIndent.length)) {
    return undefined;
  }
  return [
    opening,
    `${argumentIndent}${renderedArgument}`,
    `${indentText(depth)}))`,
  ].join("\n");
}

function rustInvocationParts(expression: RustExpr): {
  readonly callable: string;
  readonly arguments: readonly RustExpr[];
} | undefined {
  switch (expression.kind) {
    case "bottom":
      return rustInvocationParts(expression.expression);
    case "string-literal":
      return {
        callable: "String::from",
        arguments: [{ kind: "str-literal", value: expression.value }],
      };
    case "owned-string-from-borrowed-str":
      return { callable: "String::from", arguments: [expression.expression] };
    case "call":
      return {
        callable: `${expression.path}${printRustCallTypeArguments(expression.typeArguments)}`,
        arguments: expression.args,
      };
    case "associated-call":
      return {
        callable: `${printRustAssociatedCallOwner(expression)}::${expression.method}${printRustCallTypeArguments(expression.typeArguments)}`,
        arguments: expression.args,
      };
    case "method-call":
      return {
        callable: `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}.${expression.method}${printRustCallTypeArguments(expression.typeArguments)}`,
        arguments: expression.args,
      };
    case "invoke":
      return {
        callable: printOperand(expression.callee, RustPrecedence.Postfix, false),
        arguments: expression.args,
      };
    default:
      return undefined;
  }
}

function printBorrowedNestedRustFormatArgument(
  outerCallable: string,
  argument: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  if (argument.kind !== "reference") {
    return undefined;
  }
  const nested = argument.expr;
  const nestedCall = nested.kind === "call"
    ? { callable: nested.path, arguments: nested.args }
    : nested.kind === "associated-call"
      ? {
          callable: `${printRustAssociatedCallOwner(nested)}::${nested.method}`,
          arguments: nested.args,
        }
      : nested.kind === "method-call"
        ? {
            callable: `${printOperand(nested.receiver, RustPrecedence.Postfix, false)}.${nested.method}`,
            arguments: nested.args,
          }
        : undefined;
  const nestedArgument = nestedCall?.arguments[0];
  if (nestedCall === undefined || nestedCall.arguments.length !== 1 ||
    nestedArgument === undefined || rustExpressionContainsStatementBlock(nestedArgument) ||
    rustExpressionContainsExpandedStructLiteral(nestedArgument) ||
    rustExpressionContainsPreferredVerticalMethodChain(nestedArgument)) {
    return undefined;
  }
  const referencePrefix = argument.mutable === true ? "&mut " : "&";
  const opening = `${outerCallable}(${referencePrefix}${nestedCall.callable}(`;
  const renderedArgument = printRustExpr(nestedArgument);
  const argumentIndent = indentText(depth + 1);
  if (!renderedFits(opening, column) || renderedArgument.includes("\n") ||
    !renderedFits(renderedArgument, argumentIndent.length)) {
    return undefined;
  }
  return [
    opening,
    `${argumentIndent}${renderedArgument}`,
    `${indentText(depth)}))`,
  ].join("\n");
}
