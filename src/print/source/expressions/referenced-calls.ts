import { appendToLastLine, renderedFits } from "../patterns.js";
import { indentText } from "../types.js";
import { rustFormatWidth, rustInlineFieldReceiverWidth, rustInlineFormatArgumentWidth, rustNestedCallWidth } from "../formatting.js";
import { printRustAssociatedOwner } from "./chains.js";
import { printRustAssociatedCallTarget, printRustDirectCallTarget } from "./callable.js";
import { printRustExpr } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function rustMethodHasNestedReferencedCallArgument(
  expression: Extract<RustExpr, { readonly kind: "method-call" }>,
): boolean {
  const argument = expression.args.length === 1 ? expression.args[0] : undefined;
  if (argument?.kind !== "reference" ||
    (argument.expr.kind !== "call" && argument.expr.kind !== "associated-call") ||
    argument.expr.args.length !== 1) {
    return false;
  }
  const nested = argument.expr.args[0];
  return nested?.kind === "reference" &&
    (nested.expr.kind === "call" || nested.expr.kind === "associated-call");
}

export function printFittedNestedReferencedMethodCall(
  callable: string,
  arguments_: readonly RustExpr[],
  depth: number,
  column: number,
): string | undefined {
  if (!callable.includes(".") || arguments_.length !== 1) {
    return undefined;
  }
  const argument = arguments_[0];
  if (argument?.kind !== "reference" ||
    (argument.expr.kind !== "call" && argument.expr.kind !== "associated-call") ||
    argument.expr.args.length !== 1 ||
    printRustExpr({ kind: "call", path: callable, args: arguments_ }).length <= rustNestedCallWidth) {
    return undefined;
  }
  const nestedArgument = argument.expr.args[0];
  if (nestedArgument?.kind !== "reference" ||
    (nestedArgument.expr.kind !== "call" &&
      nestedArgument.expr.kind !== "associated-call")) {
    return undefined;
  }
  const nestedCallable = argument.expr.kind === "call"
    ? printRustDirectCallTarget(argument.expr)
    : printRustAssociatedCallTarget(
        argument.expr,
      printRustAssociatedOwner(argument.expr.owner),
    );
  const reference = argument.mutable === true ? "&mut " : "&";
  const compactNestedArgument = printRustExpr(nestedArgument);
  const compactArgument = `${reference}${nestedCallable}(${compactNestedArgument})`;
  const argumentIndent = indentText(depth + 1);
  if (callable.length > rustInlineFieldReceiverWidth &&
    !compactNestedArgument.includes("\n") &&
    renderedFits(`${compactArgument},`, argumentIndent.length)) {
    return [
      `${callable}(`,
      `${argumentIndent}${compactArgument},`,
      `${indentText(depth)})`,
    ].join("\n");
  }
  const opening = `${callable}(${reference}${nestedCallable}(`;
  if (!renderedFits(opening, column)) {
    return undefined;
  }
  const renderedArgument = printRustExprFitted(
    nestedArgument,
    depth + 1,
    argumentIndent.length + 1,
  );
  if (!renderedFits(`${renderedArgument},`, argumentIndent.length)) {
    return undefined;
  }
  return [
    opening,
    appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
    `${indentText(depth)}))`,
  ].join("\n");
}

export function printFittedReferencedCallWrapper(
  outerCallable: string,
  argument: Extract<RustExpr, { readonly kind: "reference" }>,
  depth: number,
  column: number,
): string | undefined {
  const flatArgument = printRustExpr(argument);
  const argumentIndent = indentText(depth + 1);
  let opening = `${outerCallable}(`;
  let closingCount = 1;
  let current: RustExpr = argument;
  for (;;) {
    if (current.kind !== "reference" ||
      (current.expr.kind !== "call" && current.expr.kind !== "associated-call") ||
      current.expr.args.length !== 1) {
      break;
    }
    const callable = current.expr.kind === "call"
      ? printRustDirectCallTarget(current.expr)
      : printRustAssociatedCallTarget(
          current.expr,
          printRustAssociatedOwner(current.expr.owner),
        );
    const segment = `${current.mutable === true ? "&mut " : "&"}${callable}(`;
    const compactCurrent = printRustExpr(current);
    if (closingCount > 1 && !compactCurrent.includes("\n") &&
      compactCurrent.length <= rustInlineFormatArgumentWidth) {
      break;
    }
    if (column + opening.length + segment.length > rustFormatWidth) {
      break;
    }
    opening += segment;
    closingCount += 1;
    current = current.expr.args[0]!;
  }
  if (closingCount === 1) {
    if (!flatArgument.includes("\n") &&
      renderedFits(`${flatArgument},`, argumentIndent.length)) {
      return [
        `${outerCallable}(`,
        `${argumentIndent}${flatArgument},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    return undefined;
  }
  if (!renderedFits(opening, column)) {
    return undefined;
  }
  const compactCurrent = printRustExpr(current);
  const compact = `${opening}${compactCurrent}${")".repeat(closingCount)}`;
  if (!compactCurrent.includes("\n") && renderedFits(compact, column)) {
    return compact;
  }
  const collection = current.kind === "slice-literal" || current.kind === "vec-literal"
    ? current
    : current.kind === "reference" &&
        (current.expr.kind === "slice-literal" || current.expr.kind === "vec-literal")
      ? current
      : undefined;
  const collectionElements = collection === undefined
    ? undefined
    : collection.kind === "slice-literal" || collection.kind === "vec-literal"
      ? collection.elements
      : collection.expr.kind === "slice-literal" || collection.expr.kind === "vec-literal"
        ? collection.expr.elements
        : undefined;
  if (collection !== undefined && collectionElements !== undefined &&
    collectionElements.length > 1) {
    const renderedCollection = printRustExprFitted(
      collection,
      depth,
      Math.max(column + opening.length, rustFormatWidth - printRustExpr(collection).length + 1),
    );
    return appendToLastLine(
      `${opening}${renderedCollection}`,
      ")".repeat(closingCount),
    );
  }
  const renderedArgument = printRustExprFitted(
    current,
    depth + 1,
    argumentIndent.length,
  );
  if (!renderedFits(renderedArgument, argumentIndent.length)) {
    return undefined;
  }
  return [
    opening,
    appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
    `${indentText(depth)}${")".repeat(closingCount)}`,
  ].join("\n");
}
