import { appendToLastLine, escapeRustString, firstLine, lastLineLength, renderedFits } from "../patterns.js";
import { indentText } from "../types.js";
import { printFittedCall } from "./calls.js";
import { printRustAssociatedCallTarget, printRustCallMember, printRustDirectCallTarget, printRustMethodCallTarget } from "./callable.js";
import { printFittedMethodChain, printRustAssociatedOwner, rustMethodCallKeepsTrailingClosureAttached, rustMethodChain, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printOperand, RustPrecedence } from "./precedence.js";
import { printRustAssociatedCallOwnerFitted } from "./blocks.js";
import { printRustExpr } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustExpressionContainsExpandedCollectionLiteral, rustExpressionContainsExpandedStructLiteral, rustFormatArgumentCanShareLine } from "./inspection.js";
import { rustFormatWidth, rustMethodChainWidth, rustNestedCallWidth, rustNestedClosureOpeningWidth, rustNestedMethodFirstSegmentWidth } from "../formatting.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

type RustNestedInvocation = Extract<
  RustExpr,
  { readonly kind: "call" | "associated-call" | "invoke" }
>;

export function printFittedNestedCallWrapper(
  outerCallable: string,
  nested: RustNestedInvocation,
  depth: number,
  column: number,
): string | undefined {
  const nestedCallable = nested.kind === "invoke"
    ? undefined
    : nested.kind === "call"
      ? printRustDirectCallTarget(nested)
      : printRustAssociatedCallTarget(
          nested,
          printRustAssociatedOwner(nested.owner),
        );
  const referencedArgument = nested.args.length === 1 &&
      nested.args[0]?.kind === "reference" && nested.args[0].mutable !== true
    ? nested.args[0].expr
    : undefined;
  const borrowedCollection = referencedArgument?.kind === "slice-literal" ||
      referencedArgument?.kind === "vec-literal"
    ? referencedArgument
    : undefined;
  if (nestedCallable !== undefined && borrowedCollection !== undefined) {
    const collection = borrowedCollection;
    const collectionOpening = collection.kind === "vec-literal" ? "vec![" : "[";
    const opening = `${outerCallable}(${nestedCallable}(&${collectionOpening}`;
    if (renderedFits(opening, column)) {
      const elementIndent = indentText(depth + 1);
      const expanded = [
        opening,
        ...collection.elements.map((element) => appendToLastLine(
          `${elementIndent}${printRustExprFitted(
            element,
            depth + 1,
            elementIndent.length,
          )}`,
          ",",
        )),
        `${indentText(depth)}]))`,
      ].join("\n");
      if (renderedFits(expanded, column)) {
        return expanded;
      }
    }
  }
  const nestedCollection = nested.args.length === 1 &&
      (nested.args[0]?.kind === "vec-literal" ||
        nested.args[0]?.kind === "slice-literal" ||
        nested.args[0]?.kind === "tuple-literal")
    ? nested.args[0]
    : undefined;
  if (nestedCallable !== undefined && nestedCollection !== undefined) {
    const collectionOpening = nestedCollection.kind === "vec-literal"
      ? "vec!["
      : nestedCollection.kind === "slice-literal"
        ? "["
        : "(";
    const collectionClosing = nestedCollection.kind === "tuple-literal" ? ")" : "]";
    const attachedOpening = `${outerCallable}(${nestedCallable}(${collectionOpening}`;
    const argumentIndent = indentText(depth + 1);
    const attachedCollection = [
      attachedOpening,
      ...nestedCollection.elements.map((element) => appendToLastLine(
        `${argumentIndent}${printRustExprFitted(
          element,
          depth + 1,
          argumentIndent.length,
        )}`,
        ",",
      )),
      `${indentText(depth)}${collectionClosing}))`,
    ].join("\n");
    if (renderedFits(attachedCollection, column)) {
      return attachedCollection;
    }
    const opening = `${outerCallable}(${nestedCallable}(`;
    const renderedCollection = printRustExprFitted(
      nestedCollection,
      depth + 1,
      argumentIndent.length,
    );
    const expanded = [
      opening,
      appendToLastLine(`${argumentIndent}${renderedCollection}`, ","),
      `${indentText(depth)}))`,
    ].join("\n");
    if (renderedFits(expanded, column)) {
      return expanded;
    }
  }
  const soleNestedArgument = nested.args.length === 1
    ? nested.args[0]
    : undefined;
  if (soleNestedArgument?.kind === "try") {
    const argumentIndent = indentText(depth + 1);
    const flatArgument = printRustExpr(soleNestedArgument);
    const nestedCallable = printRustNestedInvocationTarget(nested);
    const opening = `${outerCallable}(${nestedCallable}(`;
    const fallibleCall = soleNestedArgument.expr.kind === "call" ||
        soleNestedArgument.expr.kind === "associated-call"
      ? soleNestedArgument.expr
      : undefined;
    const fallibleCallArgument = fallibleCall?.args.length === 1
      ? fallibleCall.args[0]
      : undefined;
    if (fallibleCall !== undefined) {
      const fallibleCallable = printRustNestedInvocationTarget(fallibleCall);
      const fallibleArgument = fallibleCall.args.length === 1
        ? fallibleCall.args[0]
        : undefined;
      const projectedOpeningWidth = fallibleArgument === undefined
        ? 0
        : rustNestedInvocationOpeningWidth(fallibleArgument);
      if (projectedOpeningWidth > 0 &&
        column + opening.length + fallibleCallable.length + 1 + projectedOpeningWidth >
          rustFormatWidth) {
        const rendered = printNestedCallArgument(
          soleNestedArgument,
          depth + 1,
          argumentIndent.length + 1,
          true,
        );
        return [
          opening,
          appendToLastLine(`${argumentIndent}${rendered}`, ","),
          `${indentText(depth)}))`,
        ].join("\n");
      }
      const renderedFallible = printFittedCall(
        fallibleCallable,
        fallibleCall.args,
        depth,
        column + opening.length,
      );
      const attachedFallible = appendToLastLine(
        `${opening}${renderedFallible}`,
        "?))",
      );
      if (renderedFallible.includes("\n") && renderedFits(attachedFallible, column)) {
        return attachedFallible;
      }
    }
    if (fallibleCall !== undefined && fallibleCallArgument !== undefined &&
      opening.length + flatArgument.length + 2 > rustNestedCallWidth) {
      const flatFallibleArgument = printRustExpr(fallibleCallArgument);
      const fallibleCallable = printRustNestedInvocationTarget(fallibleCall);
      const fallibleOpening = `${opening}${fallibleCallable}(`;
      if (!flatFallibleArgument.includes("\n") &&
        renderedFits(fallibleOpening, column) &&
        renderedFits(`${flatFallibleArgument},`, argumentIndent.length)) {
        return [
          fallibleOpening,
          `${argumentIndent}${flatFallibleArgument},`,
          `${indentText(depth)})?))`,
        ].join("\n");
      }
    }
    if (renderedFits(opening, column) &&
      renderedFits(`${flatArgument},`, argumentIndent.length)) {
      return [
        opening,
        `${argumentIndent}${flatArgument},`,
        `${indentText(depth)}))`,
      ].join("\n");
    }
  }
  if (nestedCallable !== undefined &&
    (soleNestedArgument?.kind === "call" || soleNestedArgument?.kind === "associated-call") &&
    soleNestedArgument.args.length > 1) {
    const innerCallable = printRustNestedInvocationTarget(soleNestedArgument);
    const attachedOpening = `${outerCallable}(${nestedCallable}(${innerCallable}(`;
    if (attachedOpening.length > rustNestedCallWidth) {
      const opening = `${outerCallable}(${nestedCallable}(`;
      const argumentIndent = indentText(depth + 1);
      const renderedArgument = printRustExprFitted(
        soleNestedArgument,
        depth + 1,
        argumentIndent.length,
      );
      const expanded = [
        opening,
        appendToLastLine(`${argumentIndent}${renderedArgument}`, ","),
        `${indentText(depth)}))`,
      ].join("\n");
      if (renderedFits(expanded, column)) {
        return expanded;
      }
    }
  }
  const singleArgumentChain = nested.kind === "invoke"
    ? undefined
    : collectNestedCallExpressionChain(nested);
  const chainTerminalArgument = singleArgumentChain?.arguments.length === 1
    ? singleArgumentChain.arguments[0]
    : undefined;
  const stringChainOwnsBreak = chainTerminalArgument?.kind === "string-literal" ||
    chainTerminalArgument?.kind === "owned-string-from-borrowed-str" ||
    chainTerminalArgument?.kind === "str-literal";
  if (nested.kind !== "invoke" && !stringChainOwnsBreak) {
    const nestedCallable = printRustNestedInvocationTarget(nested);
    const nestedFirstLineWidth = Math.min(
      rustNestedCallWidth,
      rustFormatWidth - column - outerCallable.length - 3,
    );
    const renderedNested = printFittedCall(
      nestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
      false,
      depth,
      { maximumFirstLineWidth: nestedFirstLineWidth },
    );
    const nestedWithinCallWidth = firstLine(renderedNested).length <= nestedFirstLineWidth
      ? renderedNested
      : printFittedCall(
          nestedCallable,
          nested.args,
          depth,
          column + outerCallable.length + 1,
          true,
          false,
          depth,
          { forceArgumentListBreak: true },
        );
    const attached = appendToLastLine(`${outerCallable}(${nestedWithinCallWidth}`, ")");
    const jointlyFittingArguments = nested.args.length <= 3 &&
      nested.args.every(rustFormatArgumentCanShareLine) &&
      nested.args.map(printRustExpr).join(", ").length <= rustNestedCallWidth;
    const trailingClosureOwnsLayout = nested.args.length > 1 &&
      nested.args.slice(0, -1).every(rustFormatArgumentCanShareLine) &&
      (nested.args[nested.args.length - 1]?.kind === "closure" ||
        nested.args[nested.args.length - 1]?.kind === "closure-block");
    if (nestedWithinCallWidth.includes("\n") && renderedFits(attached, column) &&
      (firstLine(attached).length <= rustNestedMethodFirstSegmentWidth ||
        jointlyFittingArguments || trailingClosureOwnsLayout)) {
      return attached;
    }
  }
  if (nested.kind === "invoke") {
    return undefined;
  }
  if (singleArgumentChain !== undefined && chainTerminalArgument !== undefined) {
    const terminalStringInput = chainTerminalArgument.kind === "string-literal"
      ? {
          flat: `"${escapeRustString(chainTerminalArgument.value)}"`,
          fitted: `"${escapeRustString(chainTerminalArgument.value)}"`,
          owned: true,
        }
      : chainTerminalArgument.kind === "owned-string-from-borrowed-str"
        ? {
            flat: printRustExpr(chainTerminalArgument.expression),
            fitted: printRustExprFitted(
              chainTerminalArgument.expression,
              depth + 1,
              indentText(depth + 1).length,
            ),
            owned: true,
          }
        : chainTerminalArgument.kind === "str-literal"
          ? {
              flat: `"${escapeRustString(chainTerminalArgument.value)}"`,
              fitted: `"${escapeRustString(chainTerminalArgument.value)}"`,
              owned: false,
            }
          : undefined;
    if (terminalStringInput !== undefined) {
      const opening = `${outerCallable}(${singleArgumentChain.callables.map((callable) =>
        `${callable}(`).join("")}`;
      const stringOpening = terminalStringInput.owned
        ? `${opening}String::from(`
        : opening;
      const stringClosing = ")".repeat(singleArgumentChain.callables.length +
        (terminalStringInput.owned ? 2 : 1));
      if (stringOpening.length + terminalStringInput.flat.length +
          stringClosing.length > rustNestedCallWidth &&
        column + stringOpening.length <= rustNestedMethodFirstSegmentWidth &&
        renderedFits(stringOpening, column)) {
        const argumentIndent = indentText(depth + 1);
        return [
          stringOpening,
          appendToLastLine(`${argumentIndent}${terminalStringInput.fitted}`, ","),
          `${indentText(depth)}${stringClosing}`,
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
        `::${printRustCallMember(nested.method, nested.genericArguments)}(`,
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
  const selectedNestedCallable = nested.kind === "call"
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
    const opening = `${outerCallable}(${selectedNestedCallable}(`;
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
  if (nested.args.length === 0) {
    return undefined;
  }
  const opening = `${outerCallable}(${selectedNestedCallable}(`;
  if (renderedFits(opening, column) &&
    (nested.args.length === 1 ||
      opening.length <= rustNestedMethodFirstSegmentWidth)) {
    const nestedFirstLineWidth = Math.min(
      rustNestedCallWidth,
      rustFormatWidth - column - outerCallable.length - 3,
    );
    const nestedRendered = printFittedCall(
      selectedNestedCallable,
      nested.args,
      depth,
      column + outerCallable.length + 1,
      true,
      false,
      depth,
      { maximumFirstLineWidth: nestedFirstLineWidth },
    );
    const nestedWithinCallWidth = firstLine(nestedRendered).length <= nestedFirstLineWidth
      ? nestedRendered
      : printFittedCall(
          selectedNestedCallable,
          nested.args,
          depth,
          column + outerCallable.length + 1,
          true,
          false,
          depth,
          { forceArgumentListBreak: true },
        );
    const attached = appendToLastLine(`${outerCallable}(${nestedWithinCallWidth}`, ")");
    if (nestedWithinCallWidth.includes("\n") && renderedFits(attached, column)) {
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
    selectedNestedCallable,
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

function printRustNestedInvocationTarget(expression: RustNestedInvocation): string {
  switch (expression.kind) {
    case "call":
      return printRustDirectCallTarget(expression);
    case "associated-call":
      return printRustAssociatedCallTarget(
        expression,
        printRustAssociatedOwner(expression.owner),
      );
    case "invoke":
      return printOperand(expression.callee, RustPrecedence.Postfix, false);
  }
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

function collectNestedCallExpressionChain(
  expression: Extract<RustExpr, { readonly kind: "call" | "associated-call" }>,
): {
  readonly callables: readonly string[];
  readonly arguments: readonly RustExpr[];
} {
  const callables: string[] = [];
  let current = expression;
  for (;;) {
    callables.push(current.kind === "call"
      ? printRustDirectCallTarget(current)
      : printRustAssociatedCallTarget(current, printRustAssociatedOwner(current.owner)));
    const argument = current.args.length === 1 ? current.args[0] : undefined;
    if (argument?.kind !== "call" && argument?.kind !== "associated-call") {
      return { callables, arguments: current.args };
    }
    current = argument;
  }
}

function rustNestedInvocationOpeningWidth(expression: RustExpr): number {
  if (expression.kind === "try") {
    return rustNestedInvocationOpeningWidth(expression.expr);
  }
  if (expression.kind === "reference") {
    return 1 + rustNestedInvocationOpeningWidth(expression.expr);
  }
  if (expression.kind === "call" || expression.kind === "associated-call" ||
    expression.kind === "invoke") {
    return printRustNestedInvocationTarget(expression).length + 1;
  }
  if (expression.kind === "method-call") {
    const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
    return printRustMethodCallTarget(expression, receiver).length + 1;
  }
  return 0;
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
