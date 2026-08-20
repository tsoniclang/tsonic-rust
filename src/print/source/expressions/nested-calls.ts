import { appendToLastLine, escapeRustString, firstLine, lastLineLength, renderedFits } from "../patterns.js";
import { collectNestedCallExpressionChain } from "../blocks.js";
import { indentText } from "../types.js";
import { printFittedCall } from "./calls.js";
import { printRustAssociatedCallTarget, printRustCallMember, printRustDirectCallTarget, printRustMethodCallTarget } from "./callable.js";
import { printFittedMethodChain, printRustAssociatedOwner, rustMethodCallKeepsTrailingClosureAttached, rustMethodChain, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printOperand, RustPrecedence } from "./precedence.js";
import { printRustAssociatedCallOwnerFitted } from "./blocks.js";
import { printRustExpr } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustExpressionContainsExpandedCollectionLiteral, rustExpressionContainsExpandedStructLiteral } from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import { rustFormatWidth, rustMethodChainWidth, rustNestedCallWidth, rustNestedClosureOpeningWidth } from "../formatting.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function printFittedNestedCallWrapper(
  outerCallable: string,
  nested: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
  depth: number,
  column: number,
): string | undefined {
  if (nested.args.length > 1) {
    const nestedCallable = nested.kind === "call"
      ? printRustDirectCallTarget(nested)
      : printRustAssociatedCallTarget(nested, printRustAssociatedOwner(nested.owner));
    const renderedNested = printFittedCall(
      nestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
    );
    const attached = appendToLastLine(`${outerCallable}(${renderedNested}`, ")");
    if (renderedNested.includes("\n")) {
      return attached;
    }
  }
  const singleArgumentChain = collectNestedCallExpressionChain(nested);
  if (singleArgumentChain !== undefined && singleArgumentChain.arguments.length === 1) {
    const opening = `${outerCallable}(${singleArgumentChain.callables.map((callable) =>
      `${callable}(`).join("")}`;
    const closing = ")".repeat(singleArgumentChain.callables.length + 1);
    const terminalArgument = singleArgumentChain.arguments[0]!;
    const terminalFlat = printRustExpr(terminalArgument);
    const ownedStringInput = terminalArgument.kind === "string-literal"
      ? {
          flat: `"${escapeRustString(terminalArgument.value)}"`,
          fitted: `"${escapeRustString(terminalArgument.value)}"`,
        }
      : terminalArgument.kind === "owned-string-from-borrowed-str"
        ? {
            flat: printRustExpr(terminalArgument.expression),
            fitted: printRustExprFitted(
              terminalArgument.expression,
              depth + 1,
              indentText(depth + 1).length,
            ),
          }
        : undefined;
    if (ownedStringInput !== undefined) {
      const ownedStringOpening = `${opening}String::from(`;
      const ownedStringClosing = ")".repeat(singleArgumentChain.callables.length + 2);
      if (ownedStringOpening.length + ownedStringInput.flat.length +
          ownedStringClosing.length > rustNestedCallWidth &&
        renderedFits(ownedStringOpening, column)) {
        const argumentIndent = indentText(depth + 1);
        return [
          ownedStringOpening,
          appendToLastLine(`${argumentIndent}${ownedStringInput.fitted}`, ","),
          `${indentText(depth)}${ownedStringClosing}`,
        ].join("\n");
      }
    }
    if (singleArgumentChain.callables.length > 1) {
      if (terminalArgument.kind === "block" || terminalArgument.kind === "evaluate-then") {
        const terminal = printRustExprFitted(
          terminalArgument,
          depth,
          column + opening.length,
        );
        const attached = appendToLastLine(`${opening}${terminal}`, closing);
        if (column + firstLine(attached).length <= rustFormatWidth) {
          return attached;
        }
      }
      if (opening.length + terminalFlat.length + closing.length > rustNestedCallWidth &&
        renderedFits(opening, column)) {
        const argumentIndent = indentText(depth + 1);
        const terminal = printRustExprFitted(
          terminalArgument,
          depth + 1,
          argumentIndent.length,
        );
        return [
          opening,
          appendToLastLine(`${argumentIndent}${terminal}`, ","),
          `${indentText(depth)}${closing}`,
        ].join("\n");
      }
    }
  }
  if (nested.kind === "associated-call" && nested.args.length === 1 &&
    (nested.args[0]?.kind === "closure" || nested.args[0]?.kind === "closure-block")) {
    const owner = printRustAssociatedCallOwnerFitted(
      nested,
      depth,
      column + outerCallable.length + 1,
    );
    if (owner.includes("\n")) {
      const opening = appendToLastLine(
        `${outerCallable}(${owner}`,
        `::${printRustCallMember(nested.method, nested.typeArguments)}(`,
      );
      const attachedArgument = printRustExprFitted(
        nested.args[0],
        depth,
        lastLineLength(opening),
      );
      const attached = appendToLastLine(`${opening}${attachedArgument}`, "))");
      if (renderedFits(attached, column)) {
        return attached;
      }
      const argumentIndent = indentText(depth + 1);
      const renderedArgument = printRustExprFitted(
        nested.args[0],
        depth + 1,
        argumentIndent.length,
      );
      return [
        opening,
        appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
        `${indentText(depth)}))`,
      ].join("\n");
    }
  }
  const nestedCallable = nested.kind === "call"
    ? printRustDirectCallTarget(nested)
    : printRustAssociatedCallTarget(nested, printRustAssociatedOwner(nested.owner));
  const argumentIndent = indentText(depth + 1);
  const nestedClosureChain = collectNestedClosureCallChain(nested);
  if (nestedClosureChain !== undefined) {
    const opening = `${outerCallable}(${nestedClosureChain.callables.map((callable) => `${callable}(`).join("")}`;
    if (renderedFits(opening, column) &&
      opening.length + column <= rustNestedClosureOpeningWidth) {
      const renderedArgument = printRustExprFitted(
        nestedClosureChain.closure,
        depth + 1,
        argumentIndent.length,
      );
      return [
        opening,
        appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
        `${indentText(depth)}${")".repeat(nestedClosureChain.callables.length + 1)}`,
      ].join("\n");
    }
  }
  if (nested.args.length === 1 &&
    (nested.args[0]?.kind === "closure" || nested.args[0]?.kind === "closure-block")) {
    const opening = `${outerCallable}(${nestedCallable}(`;
    if (!renderedFits(opening, column) ||
      opening.length + column > rustNestedClosureOpeningWidth) {
      return undefined;
    }
    const renderedArgument = printRustExprFitted(
      nested.args[0],
      depth + 1,
      argumentIndent.length,
    );
    return [
      opening,
      appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
      `${indentText(depth)}))`,
    ].join("\n");
  }
  if (nested.args.length === 0 || nested.args.some(rustExpressionContainsStatementBlock)) {
    return undefined;
  }
  const opening = `${outerCallable}(${nestedCallable}(`;
  if (renderedFits(opening, column)) {
    const nestedRendered = printFittedCall(
      nestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
    );
    const attached = appendToLastLine(`${outerCallable}(${nestedRendered}`, ")");
    if (nestedRendered.includes("\n") && renderedFits(attached, column)) {
      return attached;
    }
  }
  const flatNested = printRustExpr(nested);
  const nestedArgumentOwnsBreak = nested.args.some((argument) =>
    argument.kind === "call" || argument.kind === "associated-call" ||
    argument.kind === "method-call" || argument.kind === "try" ||
    argument.kind === "reference" &&
      (argument.expr.kind === "call" || argument.expr.kind === "associated-call" ||
        argument.expr.kind === "method-call" || argument.expr.kind === "try"));
  if (!nestedArgumentOwnsBreak && !flatNested.includes("\n") &&
    renderedFits(`${flatNested},`, argumentIndent.length)) {
    const expanded = [
      `${outerCallable}(`,
      `${argumentIndent}${flatNested},`,
      `${indentText(depth)})`,
    ].join("\n");
    if (renderedFits(expanded, column)) {
      return expanded;
    }
  }
  const nestedRendered = printFittedCall(
    nestedCallable,
    nested.args,
    depth + 1,
    argumentIndent.length,
  );
  const expanded = [
    `${outerCallable}(`,
    appendToLastLine(`${argumentIndent}${nestedRendered}`, ","),
    `${indentText(depth)})`,
  ].join("\n");
  return renderedFits(expanded, column) ? expanded : undefined;
}

function collectNestedClosureCallChain(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): {
  readonly callables: readonly string[];
  readonly closure: Extract<RustExpr, { readonly kind: "closure" | "closure-block" }>;
} | undefined {
  const callables: string[] = [];
  let current = expression;
  for (;;) {
    callables.push(current.kind === "call"
      ? printRustDirectCallTarget(current)
      : printRustAssociatedCallTarget(current, printRustAssociatedOwner(current.owner)));
    if (current.args.length !== 1) {
      return undefined;
    }
    const argument = current.args[0];
    if (argument?.kind === "closure" || argument?.kind === "closure-block") {
      return { callables, closure: argument };
    }
    if (argument?.kind !== "call" && argument?.kind !== "associated-call") {
      return undefined;
    }
    current = argument;
  }
}

export function printNestedCallArgument(
  argument: Extract<RustExpr, { readonly kind: "call" | "associated-call" | "method-call" | "try" }>,
  depth: number,
  column: number,
  forceExpanded: boolean,
): string {
  if (argument.kind === "try") {
    const inner = argument.expr;
    if (inner.kind === "call" && (forceExpanded || printRustExpr(inner).length > rustNestedCallWidth)) {
      return appendToLastLine(
        printFittedCall(printRustDirectCallTarget(inner), inner.args, depth, column + 1, true),
        "?",
      );
    }
    if (inner.kind === "associated-call" &&
      (forceExpanded || printRustExpr(inner).length > rustNestedCallWidth)) {
      return appendToLastLine(
        printFittedCall(
          printRustAssociatedCallTarget(inner, printRustAssociatedOwner(inner.owner)),
          inner.args,
          depth,
          column + 1,
          true,
        ),
        "?",
      );
    }
    if (inner.kind === "method-call" &&
      (forceExpanded || !renderedFits(printRustExpr(inner), column + 1))) {
      const chain = rustMethodChain(inner);
      return appendToLastLine(
        chain === undefined
          ? printRustExprFitted(inner, depth, column + 1)
          : printFittedMethodChain(chain, depth, column + 1, true),
        "?",
      );
    }
    return printRustExprFitted(argument, depth, column);
  }
  const flatArgument = printRustExpr(argument);
  if (!forceExpanded && argument.kind === "method-call" &&
    rustMethodCallKeepsTrailingClosureAttached(argument, depth, column)) {
    return printRustExprFitted(argument, depth, column);
  }
  if (!forceExpanded && argument.kind === "method-call" &&
    rustMethodChainPrefersVerticalLayout(argument)) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined) {
      return printFittedMethodChain(chain, depth, column, true);
    }
  }
  if (!forceExpanded && argument.kind === "method-call" &&
    (!renderedFits(flatArgument, column) || flatArgument.length > rustMethodChainWidth)) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain)) {
      return printFittedMethodChain(chain, depth, column);
    }
  }
  const compactNestedCall = !rustExpressionContainsExpandedStructLiteral(argument) &&
    !rustExpressionContainsExpandedCollectionLiteral(argument) &&
    (argument.kind === "method-call"
    ? renderedFits(flatArgument, column)
    : flatArgument.length <= rustNestedCallWidth);
  if (!forceExpanded && compactNestedCall) {
    const flat = flatArgument;
    if (renderedFits(flat, column)) {
      return flat;
    }
    if (argument.kind === "associated-call") {
      return printRustExprFitted(argument, depth, column);
    }
    if (argument.kind === "call") {
      return printFittedCall(
        printRustDirectCallTarget(argument),
        argument.args,
        depth,
        column,
        true,
      );
    }
    const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
    return printFittedCall(
      printRustMethodCallTarget(argument, receiver),
      argument.args,
      depth,
      column,
      true,
    );
  }
  if (argument.kind === "associated-call") {
    return printRustExprFitted(argument, depth, column);
  }
  if (argument.kind === "call") {
    return printFittedCall(
      printRustDirectCallTarget(argument),
      argument.args,
      depth,
      column,
      true,
    );
  }
  if (forceExpanded) {
    const chain = rustMethodChain(argument);
    if (chain !== undefined) {
      return printFittedMethodChain(chain, depth, column, true);
    }
  }
  const receiver = printOperand(argument.receiver, RustPrecedence.Postfix, false);
  return printFittedCall(
    printRustMethodCallTarget(argument, receiver),
    argument.args,
    depth,
    column,
    true,
  );
}
