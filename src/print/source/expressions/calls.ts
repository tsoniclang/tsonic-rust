import { appendToLastLine, firstLine, renderedFits } from "../patterns.js";
import { expressionIsRightHandBlock, printOperand, RustPrecedence } from "./precedence.js";
import { indentText } from "../types.js";
import { printFittedMethodChain, printRustAssociatedOwner, printRustVerticalMethodChainSlot, rustMethodCallKeepsTrailingClosureAttached, rustMethodChain, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainContainsClosure, rustMethodChainFirstSegmentWidth, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printRustAssociatedCallTarget, printRustDirectCallTarget, printRustMethodCallTarget } from "./callable.js";
import { printFittedNestedCallWrapper, printNestedCallArgument } from "./nested-calls.js";
import { printRustClosureFitted } from "./blocks.js";
import { printRustExpr, rustExpressionContainsPreferredVerticalMethodChain } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustExpressionContainsExpandedCollectionLiteral, rustExpressionContainsExpandedStructLiteral, rustFormatArgumentCanShareLine, rustFormatArgumentIsAtomic } from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import { rustCompactTrailingClosureWidth, rustFormatWidth, rustInlineClosureFieldReceiverWidth, rustInlineFieldReceiverWidth, rustMethodChainWidth, rustNestedCallWidth, rustNestedClosureOpeningWidth, rustNestedMethodFirstSegmentWidth, rustSingleLineConditionalWidth } from "../formatting.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function printFittedCall(
  callable: string,
  arguments_: readonly RustExpr[],
  depth: number,
  column: number,
  forceExpanded = false,
  preferNestedBreak = false,
  inlineArgumentDepth = depth,
  layout?: {
    readonly trailingContinuationWidth?: number;
    readonly forceArgumentListBreak?: boolean;
    readonly maximumFirstLineWidth?: number;
    readonly parentRegion?: "default" | "initializer-continuation" |
      "logical-chain-operand" | "vertical-call-argument" | "block-arm";
  },
): string {
  const flatArguments = arguments_.map(printRustExpr).join(", ");
  const flat = `${callable}(${flatArguments})`;
  if (arguments_.length === 0) {
    return flat;
  }
  if (layout?.forceArgumentListBreak === true) {
    return printVerticalCallArguments(callable, arguments_, depth, column, forceExpanded);
  }
  const reservedTrailingWidth = forceExpanded
    ? Math.max(2, layout?.trailingContinuationWidth ?? 0)
    : layout?.trailingContinuationWidth ?? 0;
  const soleArgument = arguments_[0];
  const nestedStringChainOwnsLayout = arguments_.length === 1 &&
    (soleArgument?.kind === "call" || soleArgument?.kind === "associated-call" ||
      soleArgument?.kind === "method-call") &&
    rustNestedCallChainEndsInString(soleArgument) &&
    flat.length > rustNestedCallWidth;
  if (!forceExpanded && !flat.includes("\n") &&
    flatArguments.length <= rustNestedCallWidth &&
    !nestedStringChainOwnsLayout &&
    !(arguments_.length === 1 && arguments_[0]?.kind === "conditional" &&
      flatArguments.length > rustSingleLineConditionalWidth) &&
    !arguments_.some(rustExpressionContainsStatementBlock) &&
    !arguments_.some(rustExpressionContainsPreferredVerticalMethodChain) &&
    !arguments_.some(rustExpressionContainsExpandedStructLiteral) &&
    renderedFits(`${flat}${" ".repeat(reservedTrailingWidth)}`, column)) {
    return flat;
  }
  if (!forceExpanded && callable.length >= 4 && arguments_.length === 1 &&
    soleArgument?.kind === "method-call" && !flat.includes("\n") &&
    !renderedFits(flat, column)) {
    const nestedFlat = printRustExpr(soleArgument);
    const argumentIndent = indentText(depth + 1);
    if (nestedFlat.length > rustNestedCallWidth &&
      nestedFlat.length <= rustNestedCallWidth + 8 &&
      renderedFits(`${nestedFlat},`, argumentIndent.length + 4)) {
      return [
        `${callable}(`,
        `${argumentIndent}${nestedFlat},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  const shortWrapperChain = callable.length < 4 && arguments_.length === 1 &&
      soleArgument !== undefined
    ? rustMethodChain(soleArgument)
    : undefined;
  const shortWrapperSelectorCount = shortWrapperChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  if (!forceExpanded && soleArgument !== undefined && shortWrapperChain !== undefined &&
    shortWrapperSelectorCount <= 1 && !flat.includes("\n") &&
    !rustExpressionContainsStatementBlock(soleArgument) &&
    !rustExpressionContainsExpandedStructLiteral(soleArgument) &&
    renderedFits(flat, column)) {
    return flat;
  }
  if (layout?.parentRegion === "vertical-call-argument" && callable.length >= 4 &&
    arguments_.length === 1 &&
    (soleArgument?.kind === "call" || soleArgument?.kind === "associated-call")) {
    const nestedCallable = soleArgument.kind === "call"
      ? printRustDirectCallTarget(soleArgument)
      : printRustAssociatedCallTarget(
          soleArgument,
          printRustAssociatedOwner(soleArgument.owner),
        );
    if (callable.length + nestedCallable.length + 2 > rustNestedCallWidth) {
      return printVerticalCallArguments(callable, arguments_, depth, column, forceExpanded);
    }
  }
  if (arguments_.length === 1 &&
    (soleArgument?.kind === "call" || soleArgument?.kind === "associated-call" ||
      soleArgument?.kind === "invoke") &&
    (forceExpanded || flat.includes("\n") || !renderedFits(flat, column))) {
    const nestedWrapper = printFittedNestedCallWrapper(
      callable,
      soleArgument,
      depth,
      column,
    );
    if (nestedWrapper !== undefined) {
      return nestedWrapper;
    }
  }
  if (arguments_.length === 1 && soleArgument?.kind === "method-call" &&
    !renderedFits(flat, column)) {
    const methodChain = rustMethodChain(soleArgument);
    const selectorCount = methodChain?.steps.filter((step) =>
      step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
    const receiver = printOperand(soleArgument.receiver, RustPrecedence.Postfix, false);
    if (selectorCount === 1 && !receiver.includes("\n")) {
      const prefix = `${callable}(`;
      const methodCallable = printRustMethodCallTarget(soleArgument, receiver);
      const renderedMethod = printFittedCall(
        methodCallable,
        soleArgument.args,
        depth,
        column + prefix.length,
        false,
        false,
        depth,
        { trailingContinuationWidth: 1 },
      );
      const nestedIndent = indentText(depth + 1);
      const nestedMethod = printRustExprFitted(
        soleArgument,
        depth + 1,
        nestedIndent.length + 1,
      );
      const attached = appendToLastLine(`${prefix}${renderedMethod}`, ")");
      const attachedOpeningFits = prefix.length + firstLine(renderedMethod).length <=
        rustNestedCallWidth;
      const overflowCompactsWhenNested = renderedMethod.includes("\n") &&
        !nestedMethod.includes("\n") &&
        !rustNestedCallChainOwnsStringBreak(soleArgument);
      if (attachedOpeningFits && !overflowCompactsWhenNested &&
        renderedFits(attached, column)) {
        return attached;
      }
    }
  }
  if (callable.length < 4 && arguments_.length === 1 && soleArgument !== undefined) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      soleArgument,
      depth,
      column + prefix.length + 1,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    const nestedIndent = indentText(depth + 1);
    const nested = rendered.includes("\n")
      ? printRustExprFitted(
          soleArgument,
          depth + 1,
          nestedIndent.length + 1,
        )
      : undefined;
    const oneLineOverflowCompactsWhenNested = rendered.split("\n").length === 2 &&
      nested?.includes("\n") === false;
    if (oneLineOverflowCompactsWhenNested && nested !== undefined &&
      renderedFits(nested, nestedIndent.length + 1)) {
      return [
        `${callable}(`,
        `${nestedIndent}${nested}`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    if (rendered.includes("\n") &&
      !expressionIsRightHandBlock(soleArgument) &&
      !oneLineOverflowCompactsWhenNested &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  if (arguments_.length === 1 && soleArgument?.kind === "string-literal" &&
    !renderedFits(flat, column)) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      soleArgument,
      depth,
      column + prefix.length + 1,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (rendered.includes("\n") && renderedFits(attached, column)) {
      return attached;
    }
  }
  const soleNestedClosureCall = arguments_.length !== 1
    ? undefined
    : soleArgument?.kind === "call" || soleArgument?.kind === "associated-call"
      ? soleArgument.args.length === 1 &&
          (soleArgument.args[0]?.kind === "closure" ||
            soleArgument.args[0]?.kind === "closure-block")
        ? soleArgument
        : undefined
      : undefined;
  if (soleNestedClosureCall !== undefined) {
    const nestedCallable = soleNestedClosureCall.kind === "call"
      ? printRustDirectCallTarget(soleNestedClosureCall)
      : printRustAssociatedCallTarget(
          soleNestedClosureCall,
          printRustAssociatedOwner(soleNestedClosureCall.owner),
        );
    if (callable.length <= rustInlineFieldReceiverWidth &&
      renderedFits(`${nestedCallable}(`, indentText(depth + 1).length) &&
      column + callable.length + nestedCallable.length + 2 >
      rustNestedClosureOpeningWidth) {
      const argumentIndent = indentText(depth + 1);
      const rendered = printRustExprFitted(
        soleNestedClosureCall,
        depth + 1,
        argumentIndent.length,
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  const soleFallibleMethod = arguments_.length === 1 && soleArgument?.kind === "try" &&
      soleArgument.expr.kind === "method-call"
    ? soleArgument.expr
    : undefined;
  const soleFallibleChain = soleFallibleMethod === undefined
    ? undefined
    : rustMethodChain(soleFallibleMethod);
  const soleFallibleSelectorCount = soleFallibleChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  if (!forceExpanded && soleArgument !== undefined && soleFallibleChain !== undefined &&
    soleFallibleSelectorCount > 1 && printRustExpr(soleArgument).length > rustNestedCallWidth) {
    const argumentIndent = indentText(depth + 1);
    const selectorIndent = indentText(depth + 2);
    const firstSegmentWidth = rustMethodChainFirstSegmentWidth(soleFallibleChain);
    const attachFirstSelector = firstSegmentWidth > rustMethodChainWidth &&
      firstSegmentWidth <= rustNestedMethodFirstSegmentWidth;
    const rendered = appendToLastLine(
      printFittedMethodChain(
        soleFallibleChain,
        depth + 1,
        argumentIndent.length,
        !attachFirstSelector,
        selectorIndent,
        attachFirstSelector,
      ),
      "?",
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${rendered}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (!forceExpanded && soleArgument !== undefined && soleFallibleChain !== undefined &&
    soleFallibleSelectorCount === 1) {
    const prefix = `${callable}(`;
    const methodCallable = printRustMethodCallTarget(
      soleFallibleMethod!,
      printOperand(soleFallibleMethod!.receiver, RustPrecedence.Postfix, false),
    );
    const rendered = appendToLastLine(printFittedCall(
      methodCallable,
      soleFallibleMethod!.args,
      depth,
      column + prefix.length,
    ), "?");
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    const multilineCallback = soleFallibleMethod!.args.some((argument) =>
      argument.kind === "closure" || argument.kind === "closure-block");
    const nestedCallOwnsBreak = printRustExpr(soleArgument).length > rustNestedCallWidth;
    if ((!rendered.includes("\n") || multilineCallback || nestedCallOwnsBreak) &&
      renderedFits(attached, column) &&
      firstLine(attached).length + column <= rustFormatWidth) {
      return attached;
    }
  }
  if (!forceExpanded && arguments_.length === 1 && soleArgument?.kind === "try" &&
    !renderedFits(flat, column)) {
    const argumentIndent = indentText(depth + 1);
    const flatArgument = printRustExpr(soleArgument);
    const prefix = `${callable}(`;
    const nested = printNestedCallArgument(
      soleArgument,
      depth,
      column + prefix.length,
      true,
    );
    const attached = appendToLastLine(`${prefix}${nested}`, ")");
    if (soleArgument.expr.kind !== "method-call" && nested.includes("\n") &&
      renderedFits(attached, column)) {
      return attached;
    }
    if (!flatArgument.includes("\n") &&
      renderedFits(`${flatArgument},`, argumentIndent.length)) {
      return [
        `${callable}(`,
        `${argumentIndent}${flatArgument},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    const rendered = printRustExprFitted(
      soleArgument,
      depth + 1,
      argumentIndent.length,
      indentText(depth + 2),
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${rendered}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
  }
  const trailingClosure = arguments_[arguments_.length - 1];
  if (trailingClosure?.kind === "closure" || trailingClosure?.kind === "closure-block") {
    const precedingArguments = arguments_.slice(0, -1);
    const preceding = precedingArguments.map(printRustExpr);
    if (preceding.every((argument) => !argument.includes("\n"))) {
      const prefix = `${callable}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
      let renderedClosure = trailingClosure.kind === "closure"
        ? printRustClosureFitted(
            trailingClosure,
            depth,
            column + prefix.length,
            arguments_.length > 1 && flatArguments.length > rustNestedCallWidth &&
              !rustFormatArgumentIsAtomic(trailingClosure.body),
          )
        : printRustExprFitted(
            trailingClosure,
            depth,
            column + prefix.length,
          );
      const trailingContinuationWidth = layout?.trailingContinuationWidth ?? 0;
      if (trailingClosure.kind === "closure" &&
        firstLine(renderedClosure).length + column + prefix.length + 1 +
          trailingContinuationWidth > rustFormatWidth) {
        const blockClosure = printRustClosureFitted(
          trailingClosure,
          depth,
          column + prefix.length,
          true,
        );
        if (firstLine(blockClosure).length + column + prefix.length <= rustFormatWidth) {
          renderedClosure = blockClosure;
        }
      }
      const expandedClosure = printRustExprFitted(
        trailingClosure,
        depth + 1,
        indentText(depth + 1).length + 1,
      );
      const expansionMakesClosureCompact = trailingClosure.kind === "closure" &&
        !expressionIsRightHandBlock(trailingClosure.body) &&
        renderedClosure.includes("\n") &&
        !expandedClosure.includes("\n");
      const attachedBlockPreservesComplexBody = trailingClosure.kind === "closure" &&
        !rustFormatArgumentIsAtomic(trailingClosure.body) &&
        (printRustExpr(trailingClosure.body).length <= rustInlineFieldReceiverWidth ||
          column + prefix.length + firstLine(renderedClosure).length <=
            rustCompactTrailingClosureWidth);
      const overflowingArgumentWidth = preceding.join(", ").length +
        (preceding.length === 0 ? 0 : 2) + firstLine(renderedClosure).length;
      const initializerContinuationOwnsAttachedClosure =
        layout?.parentRegion === "initializer-continuation" && arguments_.length > 1;
      if ((!forceExpanded || renderedClosure.includes("\n")) &&
        (!expansionMakesClosureCompact || attachedBlockPreservesComplexBody ||
          initializerContinuationOwnsAttachedClosure) &&
        overflowingArgumentWidth <= rustNestedCallWidth &&
        firstLine(renderedClosure).length + column + prefix.length + 1 +
          trailingContinuationWidth <= rustFormatWidth) {
        return appendToLastLine(`${prefix}${renderedClosure}`, ")");
      }
    }
  }
  if (arguments_.length > 1 &&
    (trailingClosure?.kind === "block" || trailingClosure?.kind === "evaluate-then")) {
    const preceding = arguments_.slice(0, -1).map(printRustExpr);
    if (preceding.every((argument) => !argument.includes("\n"))) {
      const prefix = `${callable}(${preceding.join(", ")}, `;
      const rendered = printRustExprFitted(
        trailingClosure,
        inlineArgumentDepth,
        column + prefix.length,
      );
      const inlineArgumentsOpening = `${preceding.join(", ")}, ${firstLine(rendered)}`;
      const attached = appendToLastLine(`${prefix}${rendered}`, ")");
      if (inlineArgumentsOpening.length <= rustNestedCallWidth &&
        renderedFits(attached, column)) {
        return attached;
      }
    }
  }
  if (arguments_.length > 1 && trailingClosure?.kind === "reference" &&
    expressionIsRightHandBlock(trailingClosure.expr)) {
    const preceding = arguments_.slice(0, -1).map(printRustExpr);
    if (preceding.every((argument) => !argument.includes("\n"))) {
      const prefix = `${callable}(${preceding.join(", ")}, `;
      const rendered = printRustExprFitted(
        trailingClosure,
        inlineArgumentDepth,
        column + prefix.length,
      );
      const attached = appendToLastLine(`${prefix}${rendered}`, ")");
      if (firstLine(rendered).trimStart().startsWith("&{") &&
        column + prefix.length + firstLine(rendered).length <= rustFormatWidth &&
        renderedFits(attached, column)) {
        return attached;
      }
    }
  }
  if (arguments_.length === 1 &&
    (arguments_[0]?.kind === "slice-literal" || arguments_[0]?.kind === "vec-literal" ||
      arguments_[0]?.kind === "tuple-literal")) {
    const prefix = `${callable}(`;
    return appendToLastLine(`${prefix}${printRustExprFitted(
      arguments_[0],
      depth,
      column + prefix.length + 1,
    )}`, ")");
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "reference" &&
    (arguments_[0].expr.kind === "slice-literal" ||
      arguments_[0].expr.kind === "vec-literal")) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      depth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (firstLine(rendered).length <= rustNestedCallWidth &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  if (arguments_.length === 1 &&
    (arguments_[0]?.kind === "block" || arguments_[0]?.kind === "evaluate-then" ||
      arguments_[0]?.kind === "match" ||
      arguments_[0]?.kind === "conditional")) {
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${renderedArgument}`, ")");
    const nestedMatchScrutinee = arguments_[0].kind === "match" &&
      rustExpressionContainsStatementBlock(arguments_[0].expression);
    const conditionalCanRemainAttached = arguments_[0].kind !== "conditional" ||
      firstLine(renderedArgument).trimEnd().endsWith("{") &&
        firstLine(attached).length <= rustNestedCallWidth;
    const matchCanRemainAttached = arguments_[0].kind !== "match" ||
      firstLine(renderedArgument).trimEnd().endsWith("{") &&
        column + firstLine(attached).length + 1 <= rustFormatWidth;
    if (!nestedMatchScrutinee &&
      conditionalCanRemainAttached &&
      matchCanRemainAttached &&
      column + firstLine(attached).length + 1 <= rustFormatWidth) {
      return attached;
    }
    const argumentIndent = indentText(depth + 1);
    const expanded = printRustExprFitted(
      arguments_[0],
      depth + 1,
      argumentIndent.length,
    );
    return [
      `${callable}(`,
      appendToLastLine(`${argumentIndent}${expanded}`, ","),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "unary" &&
    expressionIsRightHandBlock(arguments_[0].operand)) {
    const prefix = `${callable}(`;
    const renderedArgument = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${renderedArgument}`, ")");
    if (column + firstLine(attached).length <= rustFormatWidth) {
      return attached;
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "reference" &&
    expressionIsRightHandBlock(arguments_[0].expr)) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (column + firstLine(attached).length + 1 <= rustFormatWidth &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "reference" &&
    arguments_[0].expr.kind === "string-concat") {
    const prefix = `${callable}(${arguments_[0].mutable === true ? "&mut " : "&"}`;
    const rendered = printRustExprFitted(
      arguments_[0].expr,
      depth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (rendered.includes("\n") && renderedFits(attached, column)) {
      return attached;
    }
  }
  if (callable.length < 4 && arguments_.length === 1 && arguments_[0]?.kind === "binary" &&
    !rustExpressionContainsStatementBlock(arguments_[0])) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    if (rendered.includes("\n") && renderedFits(attached, column)) {
      return attached;
    }
  }
  const soleArithmeticArgument = arguments_.length === 1 && arguments_[0]?.kind === "binary" &&
      (arguments_[0].operator === "+" || arguments_[0].operator === "-" ||
        arguments_[0].operator === "*" || arguments_[0].operator === "/" ||
        arguments_[0].operator === "%")
    ? arguments_[0]
    : undefined;
  let firstArithmeticOperand: RustExpr | undefined = soleArithmeticArgument;
  while (firstArithmeticOperand?.kind === "binary" &&
    (firstArithmeticOperand.operator === "+" || firstArithmeticOperand.operator === "-" ||
      firstArithmeticOperand.operator === "*" || firstArithmeticOperand.operator === "/" ||
      firstArithmeticOperand.operator === "%")) {
    firstArithmeticOperand = firstArithmeticOperand.left;
  }
  if (soleArithmeticArgument !== undefined &&
    (!rustExpressionContainsStatementBlock(soleArithmeticArgument) ||
      firstArithmeticOperand?.kind === "conditional")) {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      soleArithmeticArgument,
      inlineArgumentDepth,
      column + prefix.length,
    );
    const attached = appendToLastLine(`${prefix}${rendered}`, ")");
    const callableCanOwnMultilineArithmetic =
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(callable) &&
      callable.length <= rustInlineFieldReceiverWidth;
    if ((!rendered.includes("\n") || callableCanOwnMultilineArithmetic) &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "struct-literal") {
    const prefix = `${callable}(`;
    return appendToLastLine(
      `${prefix}${printRustExprFitted(
        arguments_[0],
        depth,
        column + prefix.length,
      )}`,
      ")",
    );
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "string-concat") {
    const prefix = `${callable}(`;
    const rendered = printRustExprFitted(
      arguments_[0],
      depth,
      column + prefix.length,
    );
    if (rendered.includes("\n")) {
      return appendToLastLine(`${prefix}${rendered}`, ")");
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    const chain = rustMethodChain(arguments_[0]);
    if (chain !== undefined && expressionIsRightHandBlock(chain.base)) {
      const argumentIndent = indentText(depth + 1);
      const rendered = printRustExprFitted(
        arguments_[0],
        depth + 1,
        argumentIndent.length,
        indentText(depth + 2),
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    const prefix = `${callable}(`;
    const directChain = rustMethodChain(arguments_[0]);
    const expandedAggregateArgument = arguments_[0].args.some((argument) =>
      (argument.kind === "slice-literal" || argument.kind === "vec-literal") &&
      (argument.elements.length > 1 || rustExpressionContainsStatementBlock(argument)));
    if (directChain?.steps.length === 1 && expandedAggregateArgument) {
      const nested = printRustExprFitted(
        arguments_[0],
        depth,
        column + prefix.length,
      );
      const nestedAtExpandedColumn = printRustExprFitted(
        arguments_[0],
        depth + 1,
        indentText(depth + 1).length,
      );
      const attached = appendToLastLine(`${prefix}${nested}`, ")");
      if (nested.includes("\n") && nestedAtExpandedColumn.includes("\n") &&
        renderedFits(attached, column)) {
        return attached;
      }
    }
  }
  if (!forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    if (!flat.includes("\n") && !nestedStringChainOwnsLayout && renderedFits(flat, column) &&
      !rustMethodChainPrefersVerticalLayout(arguments_[0]) &&
      !rustExpressionContainsStatementBlock(arguments_[0]) &&
      !rustExpressionContainsExpandedStructLiteral(arguments_[0])) {
      return flat;
    }
    const chain = rustMethodChain(arguments_[0]);
    const outerCallMustOwnBreak = chain !== undefined &&
      chain.steps.length === 1 &&
      callable.length > rustInlineFieldReceiverWidth &&
      rustMethodChainBreaksReceiverWhenExpanded(chain);
    if (rustMethodChainPrefersVerticalLayout(arguments_[0]) || outerCallMustOwnBreak) {
      const inlinePrefix = `${callable}(`;
      if (chain !== undefined && rustMethodChainContainsClosure(chain) &&
        callable.length <= rustInlineFieldReceiverWidth) {
        const inline = appendToLastLine(
          `${inlinePrefix}${printFittedMethodChain(
            chain,
            depth,
            column + inlinePrefix.length,
            rustMethodChainContainsClosure(chain),
          )}`,
          ")",
        );
        if (renderedFits(inline, column)) {
          return inline;
        }
      }
      const argumentIndent = indentText(depth + 1);
      const rendered = chain === undefined
        ? printRustExprFitted(arguments_[0], depth + 1, argumentIndent.length)
        : printFittedMethodChain(chain, depth + 1, argumentIndent.length, true);
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "method-call") {
    const chain = rustMethodChain(arguments_[0]);
    if (chain !== undefined && chain.steps.length > 1 &&
      printRustExpr(arguments_[0]).length > rustMethodChainWidth) {
      const argumentIndent = indentText(depth + 1);
      const rendered = printFittedMethodChain(
        chain,
        depth + 1,
        argumentIndent.length,
        true,
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (forceExpanded && arguments_.length === 1 && arguments_[0]?.kind === "reference" &&
    (arguments_[0].expr.kind === "call" || arguments_[0].expr.kind === "associated-call" ||
      arguments_[0].expr.kind === "method-call" || arguments_[0].expr.kind === "try")) {
    const prefix = `${callable}(`;
    let nested = printNestedCallArgument(
      arguments_[0].expr,
      depth,
      column + prefix.length + 1,
      false,
    );
    nested = fitReferencedNestedCallToWidth(
      arguments_[0].expr,
      nested,
      depth,
      column + prefix.length + 1,
      (layout?.maximumFirstLineWidth ?? rustFormatWidth - column) - prefix.length - 1,
    );
    const expandedArgumentIndent = indentText(depth + 1);
    const expandedNested = printNestedCallArgument(
      arguments_[0].expr,
      depth + 1,
      expandedArgumentIndent.length + 1,
      false,
    );
    const attached = appendToLastLine(`${prefix}&${nested}`, ")");
    const oversizedNestedOpening = rustUnbreakableCallOpeningWidth(arguments_[0].expr) >
      rustNestedCallWidth;
    if (!rustPostfixStartsFromRightHandBlock(arguments_[0].expr) &&
      nested.includes("\n") &&
      (firstLine(nested).length + 1 <= rustNestedCallWidth || oversizedNestedOpening) &&
      (expandedNested.includes("\n") ||
        rustExpressionContainsExpandedCollectionLiteral(arguments_[0])) &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  if (forceExpanded && arguments_.length === 1) {
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      if (argument.kind === "call" || argument.kind === "associated-call") {
        const nestedWrapper = printFittedNestedCallWrapper(
          callable,
          argument,
          depth,
          column,
        );
        if (nestedWrapper !== undefined) {
          return nestedWrapper;
        }
      }
      const prefix = `${callable}(`;
      const expandedArgumentColumn = indentText(depth + 1).length;
      const fallibleInner = argument.kind === "try" &&
          (argument.expr.kind === "call" || argument.expr.kind === "associated-call" ||
            argument.expr.kind === "method-call")
        ? argument.expr
        : undefined;
      const fallibleInnerCallable = fallibleInner?.kind === "call"
        ? printRustDirectCallTarget(fallibleInner)
        : fallibleInner?.kind === "associated-call"
          ? printRustAssociatedCallTarget(
              fallibleInner,
              printRustAssociatedOwner(fallibleInner.owner),
            )
          : fallibleInner?.kind === "method-call"
            ? printRustMethodCallTarget(
                fallibleInner,
                printOperand(fallibleInner.receiver, RustPrecedence.Postfix, false),
              )
            : undefined;
      const compactSingleInputCall = (argument.kind === "call" ||
          argument.kind === "associated-call" || argument.kind === "method-call") &&
          argument.args.length === 1 && renderedFits(printRustExpr(argument), expandedArgumentColumn) ||
        fallibleInner !== undefined && fallibleInnerCallable !== undefined &&
          fallibleInner.args.length === 1 &&
          !renderedFits(`${prefix}${fallibleInnerCallable}(`, column) &&
          renderedFits(printRustExpr(argument), expandedArgumentColumn);
      if (!compactSingleInputCall) {
        const nested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const compact = appendToLastLine(`${prefix}${nested}`, ")");
        if (!(argument.kind === "method-call" && nested.includes("\n")) &&
          renderedFits(compact, column)) {
          return compact;
        }
      }
    }
  }
  if (preferNestedBreak && !forceExpanded && arguments_.length === 1 &&
    arguments_[0]?.kind === "method-call" && !renderedFits(flat, column)) {
    const chain = rustMethodChain(arguments_[0]);
    const argumentIndent = indentText(depth + 1);
    if (chain !== undefined && chain.steps.length > 1 &&
      !renderedFits(printRustExpr(arguments_[0]), argumentIndent.length)) {
      const rendered = printFittedMethodChain(
        chain,
        depth + 1,
        argumentIndent.length,
        true,
      );
      return [
        `${callable}(`,
        appendToLastLine(`${argumentIndent}${rendered}`, ","),
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (!forceExpanded && arguments_.length === 1) {
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      const argumentIndent = indentText(depth + 1);
      const flatArgument = printRustExpr(argument);
      const nestedInvocationArguments = argument.kind === "call" || argument.kind === "associated-call"
        ? argument.args
        : argument.kind === "try" &&
            (argument.expr.kind === "call" || argument.expr.kind === "associated-call")
          ? argument.expr.args
          : undefined;
      if ((argument.kind === "call" || argument.kind === "associated-call") &&
        (flat.includes("\n") ||
          rustNestedCallChainEndsInString(argument) && flat.length > rustNestedCallWidth ||
          flatArguments.length > rustNestedCallWidth ||
          !renderedFits(flat, column))) {
        const nestedWrapper = printFittedNestedCallWrapper(
          callable,
          argument,
          depth,
          column,
        );
        if (nestedWrapper !== undefined) {
          return nestedWrapper;
        }
      }
      if (nestedInvocationArguments !== undefined &&
        (nestedInvocationArguments.length === 1 || flatArgument.length > rustNestedCallWidth) &&
        (flatArguments.length > rustNestedCallWidth || !renderedFits(flat, column))) {
        const prefix = `${callable}(`;
        const expandedNested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const compact = appendToLastLine(`${prefix}${expandedNested}`, ")");
        if (expandedNested.includes("\n") && renderedFits(compact, column)) {
          return compact;
        }
      }
      if (!flatArgument.includes("\n") &&
        renderedFits(flatArgument, argumentIndent.length) &&
        !renderedFits(flat, column)) {
        return [
          `${callable}(`,
          `${argumentIndent}${flatArgument},`,
          `${indentText(depth)})`,
        ].join("\n");
      }
    }
  }
  if (!forceExpanded && arguments_.length === 1) {
    const prefix = `${callable}(`;
    const argument = arguments_[0]!;
    if (argument.kind === "call" || argument.kind === "associated-call" ||
      argument.kind === "method-call" || argument.kind === "try") {
      const nested = printNestedCallArgument(argument, depth, column + prefix.length, false);
      const nestedAtExpandedColumn = printNestedCallArgument(
        argument,
        depth + 1,
        indentText(depth + 1).length + 1,
        false,
      );
      const compact = appendToLastLine(`${prefix}${nested}`, ")");
      if ((flatArguments.length <= rustNestedCallWidth || nested.includes("\n")) &&
        !(argument.kind !== "call" && argument.kind !== "associated-call" &&
          nested.includes("\n") &&
          !nestedAtExpandedColumn.includes("\n")) &&
        renderedFits(compact, column)) {
        return compact;
      }
      if (preferNestedBreak) {
        const forcedNested = printNestedCallArgument(
          argument,
          depth,
          column + prefix.length,
          true,
        );
        const forcedCompact = appendToLastLine(`${prefix}${forcedNested}`, ")");
        if (renderedFits(forcedCompact, column)) {
          return forcedCompact;
        }
      }
    } else if (argument.kind === "unary" &&
      (argument.operand.kind === "call" ||
        argument.operand.kind === "associated-call" ||
        argument.operand.kind === "method-call" ||
        argument.operand.kind === "try" &&
          (argument.operand.expr.kind === "call" ||
            argument.operand.expr.kind === "associated-call" ||
            argument.operand.expr.kind === "method-call")) &&
      printRustExpr(argument.operand).length > rustNestedCallWidth) {
      const nested = printNestedCallArgument(
        argument.operand,
        depth,
        column + prefix.length + argument.operator.length,
        true,
      );
      const compact = appendToLastLine(
        `${prefix}${argument.operator}${nested}`,
        ")",
      );
      if (renderedFits(compact, column)) {
        return compact;
      }
    } else if (argument.kind === "closure" || argument.kind === "closure-block") {
      const rendered = printRustExprFitted(
        argument,
        depth,
        column + prefix.length,
      );
      const compact = appendToLastLine(`${prefix}${rendered}`, ")");
      if (renderedFits(compact, column)) {
        return compact;
      }
    } else if (argument.kind === "reference" &&
      (argument.expr.kind === "slice-literal" || argument.expr.kind === "vec-literal")) {
      const rendered = printRustExprFitted(
        argument,
        depth,
        column + prefix.length,
      );
      const compact = appendToLastLine(`${prefix}${rendered}`, ")");
      if (renderedFits(compact, column)) {
        return compact;
      }
      const collectionOpening = argument.expr.kind === "vec-literal" ? "vec![" : "[";
      const referencePrefix = argument.mutable === true ? "&mut " : "&";
      const opening = `${prefix}${referencePrefix}${collectionOpening}`;
      if (renderedFits(opening, column)) {
        const elementIndent = indentText(depth + 1);
        const elements = argument.expr.elements.map((element) =>
          appendToLastLine(
            `${elementIndent}${printRustExprFitted(
              element,
              depth + 1,
              elementIndent.length,
            )}`,
            ",",
          ));
        const expanded = [
          opening,
          ...elements,
          `${indentText(depth)}])`,
        ].join("\n");
        if (renderedFits(expanded, column)) {
          return expanded;
        }
      }
    } else if (argument.kind === "reference" &&
      (argument.expr.kind === "call" || argument.expr.kind === "associated-call" ||
        argument.expr.kind === "method-call" || argument.expr.kind === "try")) {
      if (preferNestedBreak || !renderedFits(flat, column)) {
        const nestedCollection = printPreferredReferencedNestedCollection(
          argument.expr,
          depth,
          column + prefix.length,
        );
        const compact = nestedCollection === undefined
          ? undefined
          : appendToLastLine(`${prefix}&${nestedCollection}`, ")");
        if (compact !== undefined && renderedFits(compact, column)) {
          return compact;
        }
      }
      let nested = printNestedCallArgument(
        argument.expr,
        depth,
        column + prefix.length + 1,
        flat.length > rustNestedCallWidth,
      );
      nested = fitReferencedNestedCallToWidth(
        argument.expr,
        nested,
        depth,
        column + prefix.length + 1,
        (layout?.maximumFirstLineWidth ?? rustFormatWidth - column) - prefix.length - 1,
      );
      const compact = appendToLastLine(`${prefix}&${nested}`, ")");
      const expandedArgumentIndent = indentText(depth + 1);
      const expandedNested = printNestedCallArgument(
        argument.expr,
        depth + 1,
        expandedArgumentIndent.length + 1,
        flat.length > rustNestedCallWidth,
      );
      const referencedMethodChain = argument.expr.kind === "method-call"
        ? rustMethodChain(argument.expr)
        : undefined;
      const referencedMethodSelectorCount = referencedMethodChain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      const referencedChainNeedsArgumentIndent = callable.length >= 4 &&
        referencedMethodSelectorCount > 1 && flat.length > rustNestedCallWidth;
      if (!rustPostfixStartsFromRightHandBlock(argument.expr) &&
        !referencedChainNeedsArgumentIndent &&
        !(nested.includes("\n") && !expandedNested.includes("\n")) &&
        (firstLine(nested).length + 1 <= rustNestedCallWidth ||
          rustUnbreakableCallOpeningWidth(argument.expr) > rustNestedCallWidth) &&
        renderedFits(compact, column)) {
        return compact;
      }
    } else if (!rustExpressionContainsStatementBlock(argument) &&
      !rustExpressionContainsPreferredVerticalMethodChain(argument) &&
      !rustExpressionContainsExpandedStructLiteral(argument) && renderedFits(flat, column)) {
      return flat;
    }
  } else if (!forceExpanded && !arguments_.some(rustExpressionContainsStatementBlock) &&
    !arguments_.some(rustExpressionContainsPreferredVerticalMethodChain) &&
    !arguments_.some(rustExpressionContainsExpandedStructLiteral) &&
    !flat.includes("\n") && renderedFits(flat, column) &&
    flatArguments.length <= rustNestedCallWidth) {
    return flat;
  }
  return printVerticalCallArguments(callable, arguments_, depth, column, forceExpanded);
}

function printVerticalCallArguments(
  callable: string,
  arguments_: readonly RustExpr[],
  depth: number,
  column: number,
  forceExpanded: boolean,
): string {
  const argumentIndent = indentText(depth + 1);
  const flat = `${callable}(${arguments_.map(printRustExpr).join(", ")})`;
  const compactArguments = arguments_.map(printRustExpr).join(", ");
  const openingWidth = column + callable.length + 1;
  const shareableArguments = arguments_.every(rustFormatArgumentCanShareLine);
  const compactSourceArguments = shareableArguments && arguments_.every((argument) =>
    printRustExpr(argument).length <= rustInlineClosureFieldReceiverWidth);
  const compactOverflowArguments = forceExpanded
    ? compactSourceArguments ||
      (flat.length <= rustNestedCallWidth &&
        compactArguments.length <= rustInlineFieldReceiverWidth && shareableArguments)
    : (callable.length > rustNestedCallWidth &&
        compactArguments.length <= rustNestedCallWidth && compactSourceArguments) ||
      (openingWidth <= rustNestedCallWidth && compactSourceArguments);
  const soleArgument = arguments_.length === 1 ? arguments_[0] : undefined;
  if (callable.length < 4 && soleArgument !== undefined) {
    const rendered = printRustExprFitted(
      soleArgument,
      depth + 1,
      argumentIndent.length + 1,
    );
    if (!rendered.includes("\n") && renderedFits(rendered, argumentIndent.length + 1)) {
      return [
        `${callable}(`,
        `${argumentIndent}${rendered}`,
        `${indentText(depth)})`,
      ].join("\n");
    }
  }
  if (arguments_.length > 1 &&
    compactOverflowArguments &&
    !compactArguments.includes("\n") &&
    renderedFits(`${compactArguments},`, argumentIndent.length)) {
    return [
      `${callable}(`,
      `${argumentIndent}${compactArguments},`,
      `${indentText(depth)})`,
    ].join("\n");
  }
  const renderedArguments = arguments_.map((argument) => {
    const argumentColumn = argumentIndent.length + 1;
    const attachedClosureChain = argument.kind === "method-call" &&
      rustMethodCallKeepsTrailingClosureAttached(argument, depth + 1, argumentColumn);
    const rendered = attachedClosureChain
      ? printRustExprFitted(argument, depth + 1, argumentColumn)
      : printRustVerticalMethodChainSlot(
          argument,
          depth + 1,
          argumentColumn,
          indentText(depth + 2),
        ) ?? printRustExprFitted(
          argument,
          depth + 1,
          argumentColumn,
          indentText(depth + 2),
          "expression",
          "vertical-call-argument",
        );
    return appendToLastLine(`${argumentIndent}${rendered}`, ",");
  });
  return [
    `${callable}(`,
    ...renderedArguments,
    `${indentText(depth)})`,
  ].join("\n");
}

function rustNestedCallChainEndsInString(
  expression: Extract<
    RustExpr,
    { readonly kind: "call" | "associated-call" | "method-call" }
  >,
): boolean {
  let current = expression;
  let callCount = 0;
  for (;;) {
    callCount += 1;
    if (current.args.length !== 1) {
      return false;
    }
    const argument = current.args[0];
    if (argument?.kind === "string-literal" || argument?.kind === "str-literal" ||
      argument?.kind === "owned-string-from-borrowed-str") {
      return callCount > 1 || argument.kind !== "str-literal" ||
        argument.value.length > rustInlineClosureFieldReceiverWidth;
    }
    if (argument?.kind !== "call" && argument?.kind !== "associated-call" &&
      argument?.kind !== "method-call") {
      return false;
    }
    current = argument;
  }
}

function rustNestedCallChainOwnsStringBreak(expression: RustExpr): boolean {
  let current = expression;
  for (;;) {
    if (current.kind !== "call" && current.kind !== "associated-call" &&
      current.kind !== "method-call") {
      return false;
    }
    if (current.args.length !== 1) {
      return false;
    }
    const argument = current.args[0];
    if (argument?.kind === "string-literal" || argument?.kind === "str-literal" ||
      argument?.kind === "owned-string-from-borrowed-str") {
      return printRustExpr(argument).length > rustNestedCallWidth;
    }
    if (argument?.kind !== "call" && argument?.kind !== "associated-call" &&
      argument?.kind !== "method-call") {
      return false;
    }
    current = argument;
  }
}

function rustPostfixStartsFromRightHandBlock(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return chain !== undefined && expressionIsRightHandBlock(chain.base);
}

function rustUnbreakableCallOpeningWidth(expression: RustExpr): number {
  const selected = expression.kind === "try" ? expression.expr : expression;
  if (selected.kind === "call") {
    return printRustDirectCallTarget(selected).length + 1;
  }
  if (selected.kind === "associated-call") {
    return printRustAssociatedCallTarget(
      selected,
      printRustAssociatedOwner(selected.owner),
    ).length + 1;
  }
  return 0;
}

function fitReferencedNestedCallToWidth(
  expression: RustExpr,
  rendered: string,
  depth: number,
  column: number,
  width: number,
): string {
  const openingWidth = rustUnbreakableCallOpeningWidth(expression);
  if (firstLine(rendered).length <= width || openingWidth === 0 || openingWidth > width) {
    return rendered;
  }
  const selected = expression.kind === "try" ? expression.expr : expression;
  const suffix = expression.kind === "try" ? "?" : "";
  if (selected.kind === "call") {
    return appendToLastLine(printFittedCall(
      printRustDirectCallTarget(selected),
      selected.args,
      depth,
      column,
      true,
      false,
      depth,
      { forceArgumentListBreak: true, maximumFirstLineWidth: width },
    ), suffix);
  }
  if (selected.kind === "associated-call") {
    return appendToLastLine(printFittedCall(
      printRustAssociatedCallTarget(selected, printRustAssociatedOwner(selected.owner)),
      selected.args,
      depth,
      column,
      true,
      false,
      depth,
      { forceArgumentListBreak: true, maximumFirstLineWidth: width },
    ), suffix);
  }
  return rendered;
}

function printPreferredReferencedNestedCollection(
  expression: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  if (expression.kind !== "call" && expression.kind !== "associated-call") {
    return undefined;
  }
  const collection = expression.args.length === 1 ? expression.args[0] : undefined;
  if (collection?.kind !== "vec-literal" && collection?.kind !== "slice-literal" &&
    collection?.kind !== "tuple-literal") {
    return undefined;
  }
  const callable = expression.kind === "call"
    ? printRustDirectCallTarget(expression)
    : printRustAssociatedCallTarget(
        expression,
        printRustAssociatedOwner(expression.owner),
      );
  if (!renderedFits(`${callable}(`, column)) {
    return undefined;
  }
  const argumentIndent = indentText(depth + 1);
  if (collection.elements.length > 1) {
    const opening = collection.kind === "vec-literal" ? "vec![" :
      collection.kind === "slice-literal" ? "[" : "(";
    const closing = collection.kind === "tuple-literal" ? ")" : "]";
    const attachedOpening = `${callable}(${opening}`;
    if (!renderedFits(attachedOpening, column)) {
      return undefined;
    }
    const compactElements = collection.elements.map(printRustExpr).join(", ");
    const renderedElements = collection.elements.every(rustFormatArgumentIsAtomic) &&
        compactElements.length <= rustNestedCallWidth &&
        renderedFits(`${compactElements},`, argumentIndent.length)
      ? [`${argumentIndent}${compactElements},`]
      : collection.elements.map((element) => appendToLastLine(
          `${argumentIndent}${printRustExprFitted(
            element,
            depth + 1,
            argumentIndent.length,
          )}`,
          ",",
        ));
    return [
      attachedOpening,
      ...renderedElements,
      `${indentText(depth)}${closing})`,
    ].join("\n");
  }
  return [
    `${callable}(`,
    appendToLastLine(
      `${argumentIndent}${printRustExprFitted(
        collection,
        depth + 1,
        argumentIndent.length,
      )}`,
      ",",
    ),
    `${indentText(depth)})`,
  ].join("\n");
}
