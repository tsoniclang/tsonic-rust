import { appendToLastLine, escapeRustString, firstLine, lastLine, lastLineLength, printRustMatchExpression, printRustPatternFitted, remainingLines, renderedFits, rustExpressionContainsTry } from "../patterns.js";
import { expressionIsRightHandBlock, expressionIsStatementBlockOperand, expressionNeedsParentheses, expressionPrecedence, printBinaryOperand, printFittedBinaryOperand, printOperand, RustPrecedence } from "./precedence.js";
import { indentText } from "../types.js";
import { printExpandedBinaryLeftCall } from "./binary-calls.js";
import { printFittedCall } from "./calls.js";
import { printFittedLeftAssociativeBinaryChain, printFittedLogicalChain, printFittedMethodChain, rustBinaryOperandPrefersExpandedCall, rustExpandedMethodClosureOpeningWidth, rustMethodCallKeepsTrailingClosureAttached, rustMethodChain, rustMethodChainBreaksReceiverForClosure, rustMethodChainBreaksReceiverWhenExpanded, rustMethodChainContainsClosure, rustMethodChainFirstMethodRequiresExpansion, rustMethodChainPrefersVerticalLayout, rustMethodChainRequiresVerticalLayout } from "./chains.js";
import { printRustAssociatedCallTarget, printRustCallMember, printRustDirectCallTarget, printRustMethodCallTarget } from "./callable.js";
import { printRustClosureParams } from "./closure-params.js";
import { printRustFormatArgument } from "./format-arguments.js";
import { printNestedCallArgument } from "./nested-calls.js";
import { printRustAssociatedCallOwner, printRustAssociatedCallOwnerFitted, printRustAssociatedOwnerFitted, printRustBlockExpressionLines, printRustClosureFitted, printRustConditionalArmLines } from "./blocks.js";
import { printRustBlockStatements } from "../blocks.js";
import { printRustExpr, rustExpressionContainsClosure } from "./core.js";
import { rustExpressionContainsExpandedCollectionLiteral, rustExpressionContainsExpandedStructLiteral, rustFormatArgumentCanShareLine, rustFormatArgumentIsAtomic } from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import { rustFormatWidth, rustInlineFormatArgumentWidth, rustMethodChainWidth, rustNestedCallWidth, rustSingleLineConditionalWidth } from "../formatting.js";
import { initializerPrefersReferencedNestedBreak } from "./initializer-layout.js";
import { printRustCollectionLiteralFitted, printRustStructLiteralFitted } from "./literals.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";
import type { RustExpressionGrammarPosition } from "./precedence.js";

export function printRustExprFitted(
  expression: RustExpr,
  depth: number,
  column: number,
  methodChainContinuationIndent?: string,
  grammarPosition: RustExpressionGrammarPosition = "expression",
  layoutRegion: "default" | "initializer-continuation" | "logical-chain-operand" |
    "vertical-call-argument" | "block-arm" = "default",
): string {
  const flat = printRustExpr(expression);
  switch (expression.kind) {
    case "string-literal": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      return [
        "String::from(",
        `${argumentIndent}\"${escapeRustString(expression.value)}\",`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "bottom":
      return printRustExprFitted(
        expression.expression,
        depth,
        column,
        methodChainContinuationIndent,
        grammarPosition,
        layoutRegion,
      );
    case "owned-string-from-borrowed-str":
      return printFittedCall("String::from", [expression.expression], depth, column);
    case "match":
      return printRustMatchExpression(expression, depth, column);
    case "matches": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const matched = printRustExprFitted(
        expression.expression,
        depth + 1,
        argumentIndent.length,
      );
      return [
        "matches!(",
        appendToLastLine(`${argumentIndent}${matched}`, ","),
        appendToLastLine(
          `${argumentIndent}${printRustPatternFitted(
            expression.pattern,
            depth + 1,
            argumentIndent.length,
          )}`,
          ",",
        ),
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "unreachable": {
      if (renderedFits(flat, column)) {
        return flat;
      }
      return [
        "unreachable!(",
        `${indentText(depth + 1)}"${escapeRustString(expression.message)}"`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "conditional": {
      if (grammarPosition === "expression" && !flat.includes("\n") &&
        flat.length <= rustSingleLineConditionalWidth &&
        renderedFits(flat, column)) {
        return flat;
      }
      const condition = printRustExprFitted(
        expression.condition,
        depth,
        column + "if ".length,
      );
      const conditionEnding = lastLine(condition).trim();
      const conditionEndColumn = condition.includes("\n")
        ? lastLineLength(condition)
        : column + "if ".length + lastLineLength(condition);
      const conditionCanOwnBrace = (!condition.includes("\n") ||
        conditionEnding === ")" || conditionEnding === "}" ||
        conditionEnding.endsWith("})") || conditionEnding.endsWith(")?")) &&
        conditionEndColumn + " {".length <= rustFormatWidth;
      const header = conditionCanOwnBrace
        ? `if ${condition} {`
        : `if ${condition}\n${indentText(depth)}{`;
      return [
        header,
        ...printRustConditionalArmLines(expression.whenTrue, depth + 1),
        `${indentText(depth)}} else {`,
        ...printRustConditionalArmLines(expression.whenFalse, depth + 1),
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "format-write": {
      if (expression.args.length <= 1 && !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const flatFormatArguments = expression.args.map(printRustExpr).join(", ");
      const fittedFormatArguments = expression.args.length === 0
        ? []
        : expression.args.every(rustFormatArgumentIsAtomic) &&
            !flatFormatArguments.includes("\n") &&
            renderedFits(flatFormatArguments, argumentIndent.length)
          ? [`${argumentIndent}${flatFormatArguments}`]
        : expression.args.map((argument, index) =>
          appendToLastLine(
            `${argumentIndent}${printRustExprFitted(argument, depth + 1, argumentIndent.length)}`,
            index + 1 === expression.args.length ? "" : ",",
          ));
      return [
        "write!(",
        `${argumentIndent}${printRustExpr(expression.writer)},`,
        `${argumentIndent}"${escapeRustString(expression.format)}"${expression.args.length === 0 ? "" : ","}`,
        ...fittedFormatArguments,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "block": {
      return [
        "{",
        ...printRustBlockExpressionLines(expression, depth + 1),
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "evaluate-then": {
      const statementIndent = indentText(depth + 1);
      const effectPrefix = expression.discard === "unit"
        ? statementIndent
        : `${statementIndent}let _ = `;
      const effect = printRustExprFitted(expression.effect, depth + 1, effectPrefix.length);
      const value = printRustExprFitted(
        expression.value,
        depth + 1,
        statementIndent.length,
        undefined,
        "statement",
      );
      return [
        "{",
        `${effectPrefix}${effect};`,
        `${statementIndent}${value}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "unsafe": {
      if (!rustExpressionContainsStatementBlock(expression.expression) &&
        !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const expressionIndent = indentText(depth + 1);
      const selected = printRustExprFitted(
        expression.expression,
        depth + 1,
        expressionIndent.length,
        undefined,
        "statement",
      );
      return [
        "unsafe {",
        `${expressionIndent}${selected}`,
        `${indentText(depth)}}`,
      ].join("\n");
    }
    case "string-concat": {
      const allPartsCanShareLine = expression.parts.every(rustFormatArgumentCanShareLine);
      if (expression.parts.length <= 4 &&
        (flat.length <= rustNestedCallWidth ||
          layoutRegion !== "vertical-call-argument" && layoutRegion !== "block-arm" &&
            allPartsCanShareLine && flat.length < rustInlineFormatArgumentWidth * 2) &&
        !flat.includes("\n") &&
        renderedFits(flat, column)) {
        return flat;
      }
      const argumentIndent = indentText(depth + 1);
      const placeholders = expression.parts.map(() => "{}").join("");
      const trailingPart = expression.parts[expression.parts.length - 1];
      if (trailingPart !== undefined &&
        (trailingPart.kind === "block" || trailingPart.kind === "evaluate-then")) {
        const preceding = expression.parts.slice(0, -1).map(printRustExpr);
        if (preceding.every((part) => !part.includes("\n"))) {
          const opening = `format!("${placeholders}", ${
            preceding.length === 0 ? "" : `${preceding.join(", ")}, `
          }`;
          const renderedTrailing = printRustFormatArgument(
            trailingPart,
            depth,
            column + opening.length,
          );
          const attached = appendToLastLine(`${opening}${renderedTrailing}`, ",)");
          if (renderedFits(attached, column)) {
            return attached;
          }
        }
      }
      const flatParts = expression.parts.map(printRustExpr).join(", ");
      const renderedParts = expression.parts.every(rustFormatArgumentIsAtomic) &&
          renderedFits(`${flatParts},`, argumentIndent.length)
        ? [`${argumentIndent}${flatParts},`]
        : expression.parts.map((part) => {
            const rendered = printRustFormatArgument(
              part,
              depth + 1,
              argumentIndent.length,
            );
            return appendToLastLine(`${argumentIndent}${rendered}`, ",");
          });
      return [
        "format!(",
        `${argumentIndent}\"${placeholders}\",`,
        ...renderedParts,
        `${indentText(depth)})`,
      ].join("\n");
    }
    case "associated-value": {
      if (expression.trait !== undefined) {
        return flat;
      }
      return appendToLastLine(
        printRustAssociatedOwnerFitted(
          expression.owner,
          depth,
          column + `::${expression.name}`.length,
        ),
        `::${expression.name}`,
      );
    }
    case "call":
      return printFittedCall(
        printRustDirectCallTarget(expression),
        expression.args,
        depth,
        column,
        false,
        initializerPrefersReferencedNestedBreak(expression, flat, layoutRegion),
        depth,
        { parentRegion: layoutRegion },
      );
    case "invoke":
      return printFittedCall(
        printOperand(expression.callee, RustPrecedence.Postfix, false),
        expression.args,
        depth,
        column,
        false,
        initializerPrefersReferencedNestedBreak(expression, flat, layoutRegion),
        depth,
        { parentRegion: layoutRegion },
      );
    case "associated-call":
      {
        const method = printRustCallMember(expression.method, expression.genericArguments);
        const flatCallable = `${printRustAssociatedCallOwner(expression)}::${method}`;
        if (renderedFits(`${flatCallable}(`, column)) {
          return printFittedCall(
            flatCallable,
            expression.args,
            depth,
            column,
            false,
            initializerPrefersReferencedNestedBreak(expression, flat, layoutRegion),
            depth,
            { parentRegion: layoutRegion },
          );
        }
        const owner = printRustAssociatedCallOwnerFitted(
          expression,
          depth,
          column + `::${method}(`.length,
        );
        if (owner.includes("\n") && expression.args.length === 1 &&
          (expression.args[0]?.kind === "closure" || expression.args[0]?.kind === "closure-block")) {
          const callable = appendToLastLine(owner, `::${method}(`);
          const argument = printRustExprFitted(
            expression.args[0],
            depth,
            lastLineLength(callable),
          );
          return appendToLastLine(`${callable}${argument}`, ")");
        }
        return printFittedCall(
          appendToLastLine(owner, `::${method}`),
          expression.args,
          depth,
          column,
          owner.includes("\n"),
          initializerPrefersReferencedNestedBreak(expression, flat, layoutRegion),
          depth,
          { parentRegion: layoutRegion },
        );
    }
    case "method-call": {
      const chain = rustMethodChain(expression);
      const selectorCount = chain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      const columnRequiresVerticalLayout = chain !== undefined && selectorCount > 1 &&
        !renderedFits(flat, column);
      const verticalLayout = rustMethodChainPrefersVerticalLayout(expression) ||
        columnRequiresVerticalLayout;
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      if (!flat.includes("\n") && renderedFits(flat, column) && !verticalLayout &&
        !rustExpressionContainsStatementBlock(expression) &&
        !expression.args.some((argument) =>
          argument.kind === "tuple-literal" &&
          rustExpressionContainsTry(argument) &&
          column + flat.length > rustNestedCallWidth) &&
        !rustExpressionContainsExpandedStructLiteral(expression)) {
        return flat;
      }
      const hasClosure = expression.args.some((argument) =>
        argument.kind === "closure" || argument.kind === "closure-block");
      const attachedCallable = printRustMethodCallTarget(expression, receiver);
      const attachedArgumentsPreferExpansion = expression.args.some((argument) =>
        argument.kind === "binary" || argument.kind === "tuple-literal" ||
        argument.kind === "string-concat" || argument.kind === "format-write" ||
        (argument.kind === "slice-literal" || argument.kind === "vec-literal") &&
          argument.elements.some((element) =>
            element.kind === "string-concat" || element.kind === "format-write" ||
            element.kind === "macro-invocation") ||
        rustExpressionContainsClosure(argument) ||
        rustExpressionContainsStatementBlock(argument));
      const firstStep = chain?.steps[0];
      const secondStep = chain?.steps[1];
      const firstMethodRequiresExpansion = chain === undefined
        ? false
        : rustMethodChainFirstMethodRequiresExpansion(chain, depth);
      const fieldLedCallPrefersSelectorBreak = firstStep?.kind === "field" &&
        secondStep?.kind === "method" &&
        selectorCount === 2 &&
        !firstMethodRequiresExpansion;
      const attachFirstMethodAfterField = chain !== undefined &&
        firstStep?.kind === "field" &&
        secondStep?.kind === "method" &&
        selectorCount === 2 &&
        firstMethodRequiresExpansion &&
        renderedFits(
          `${printRustExpr(chain.base)}.${firstStep.name}.${printRustCallMember(secondStep.name, secondStep.genericArguments)}(`,
          column,
        );
      if (chain !== undefined && selectorCount === 1 && !hasClosure &&
        !attachedArgumentsPreferExpansion &&
        !flat.includes("\n") && !renderedFits(flat, column)) {
        const brokenSelector = printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
        if (remainingLines(brokenSelector).length === 1 &&
          renderedFits(brokenSelector, column)) {
          return brokenSelector;
        }
      }
      if (!hasClosure && !receiver.includes("\n") && expression.args.length > 0 &&
        renderedFits(`${attachedCallable}(`, column)) {
        let attached = printFittedCall(
          attachedCallable,
          expression.args,
          depth,
          column,
        );
        const borrowedBlockArgument = expression.args.length === 1 &&
          expression.args[0]?.kind === "reference" &&
          expressionIsRightHandBlock(expression.args[0].expr);
        const attachedStatementBlockArgument = expression.args.length === 1 &&
          expressionIsRightHandBlock(expression.args[0]!);
        if (attached.includes("\n") &&
          column + firstLine(attached).length > rustMethodChainWidth &&
          !borrowedBlockArgument && !attachedArgumentsPreferExpansion) {
          attached = printFittedCall(
            attachedCallable,
            expression.args,
            depth,
            column,
            true,
          );
        }
        if (attached.includes("\n") &&
          !fieldLedCallPrefersSelectorBreak &&
          !attachFirstMethodAfterField &&
          !columnRequiresVerticalLayout &&
          (chain === undefined || attachedArgumentsPreferExpansion ||
            !rustMethodChainBreaksReceiverWhenExpanded(chain)) &&
          (!verticalLayout || attachedStatementBlockArgument ||
          chain !== undefined && (!rustMethodChainContainsClosure(chain) ||
            expression.args.length === 1 && expression.args[0]?.kind === "tuple-literal"))) {
          return attached;
        }
      }
      const expandedClosureOpening = rustExpandedMethodClosureOpeningWidth(
        expression,
        depth,
        column,
      );
      const containingExpressionRequiresReceiverBreak =
        methodChainContinuationIndent !== undefined && verticalLayout && chain !== undefined &&
        chain.steps.filter((step) =>
          step.kind === "method" || step.kind === "field" || step.kind === "await").length > 1 &&
        rustMethodChainContainsClosure(chain);
      if (hasClosure && !containingExpressionRequiresReceiverBreak && (!verticalLayout ||
          (expandedClosureOpening !== undefined &&
            expandedClosureOpening <= rustMethodChainWidth)) &&
        rustMethodCallKeepsTrailingClosureAttached(expression, depth, column)) {
        return printFittedCall(attachedCallable, expression.args, depth, column);
      }
      if (chain !== undefined && hasClosure && !renderedFits(flat, column)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          rustMethodChainBreaksReceiverForClosure(chain, flat, column),
          methodChainContinuationIndent,
        );
      }
      if (chain !== undefined && verticalLayout) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          firstStep?.kind === "field" && !attachFirstMethodAfterField ||
            containingExpressionRequiresReceiverBreak ||
            methodChainContinuationIndent !== undefined &&
              rustMethodChainRequiresVerticalLayout(expression) ||
            rustMethodChainBreaksReceiverWhenExpanded(chain) ||
            rustMethodChainBreaksReceiverForClosure(chain, flat, column) ||
            column > indentText(depth + 1).length,
          methodChainContinuationIndent,
          attachFirstMethodAfterField,
        );
      }
      if (chain !== undefined && rustMethodChainBreaksReceiverWhenExpanded(chain) &&
        !renderedFits(flat, column) &&
        (selectorCount > 1 || !renderedFits(`${attachedCallable}(`, column))) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          hasClosure,
          methodChainContinuationIndent,
        );
      }
      if (hasClosure) {
        return printFittedCall(attachedCallable, expression.args, depth, column);
      }
      return printFittedCall(attachedCallable, expression.args, depth, column);
    }
    case "closure":
      return printRustClosureFitted(expression, depth, column);
    case "closure-block": {
      const params = printRustClosureParams(expression.params);
      const prefix = `${expression.move ? "move " : ""}|${params}| ${expression.async ? "async move " : ""}{`;
      const onlyStatement = (expression.body.innerAttrs?.length ?? 0) === 0 &&
          expression.body.statements.length === 1
        ? expression.body.statements[0]
        : undefined;
      if (onlyStatement?.kind === "tail") {
        const tail = printRustExpr(onlyStatement.expr);
        const compact = `${prefix} ${tail} }`;
        if (!tail.includes("\n") &&
          !rustExpressionContainsStatementBlock(onlyStatement.expr) &&
          renderedFits(compact, column)) {
          return compact;
        }
      }
      const body = printRustBlockStatements(expression.body, depth + 1);
      return body.length === 0
        ? `${prefix}}`
        : `${prefix}\n${body}\n${indentText(depth)}}`;
    }
    case "await": {
      const chain = rustMethodChain(expression);
      if (chain !== undefined && !renderedFits(flat, column)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
      }
      const rendered = printRustExprFitted(expression.expr, depth, column);
      const attached = appendToLastLine(rendered, ".await");
      return !rendered.includes("\n") && renderedFits(attached, column) &&
          renderedFits(flat, column) && column + attached.length < rustFormatWidth
        ? attached
        : `${rendered}\n${rendered.includes("\n")
          ? indentText(depth)
          : methodChainContinuationIndent ?? indentText(depth + 1)}.await`;
    }
    case "try": {
      const chain = rustMethodChain(expression);
      const chainBaseIsInvocation = chain?.base.kind === "call" ||
        chain?.base.kind === "associated-call" || chain?.base.kind === "invoke" ||
        chain?.base.kind === "method-call";
      if (chain !== undefined && expression.expr.kind === "method-call" &&
        expression.expr.args.every(rustFormatArgumentCanShareLine) &&
        (rustMethodChainRequiresVerticalLayout(expression) ||
          chainBaseIsInvocation && flat.length > rustMethodChainWidth)) {
        return printFittedMethodChain(
          chain,
          depth,
          column,
          true,
          methodChainContinuationIndent,
        );
      }
      if ((expression.expr.kind === "call" || expression.expr.kind === "associated-call") &&
        !renderedFits(flat, column)) {
        return printNestedCallArgument(expression, depth, column, true);
      }
      if (expression.expr.kind === "method-call" &&
        rustMethodCallKeepsTrailingClosureAttached(expression.expr, depth, column + 1)) {
        const receiver = printOperand(expression.expr.receiver, RustPrecedence.Postfix, false);
        return appendToLastLine(printFittedCall(
          printRustMethodCallTarget(expression.expr, receiver),
          expression.expr.args,
          depth,
          column + 1,
        ), "?");
      }
      const rendered = printRustExprFitted(expression.expr, depth, column + 1);
      const attempted = appendToLastLine(rendered, "?");
      return renderedFits(attempted, column)
        ? attempted
        : appendToLastLine(printRustExprFitted(expression.expr, depth, column + 1), "?");
    }
    case "return-expression": {
      if (expression.expr === undefined) {
        return "return";
      }
      const prefix = "return ";
      return `${prefix}${printRustExprFitted(expression.expr, depth, column + prefix.length)}`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      const parenthesized = !expressionIsRightHandBlock(expression.expr) &&
        expressionNeedsParentheses(expression.expr, RustPrecedence.Unary, false);
      const referencedChain = rustMethodChain(expression.expr);
      const referencedSelectorCount = referencedChain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      if (!parenthesized && referencedSelectorCount <= 1 && !flat.includes("\n") &&
        renderedFits(flat, column) &&
        !rustExpressionContainsExpandedCollectionLiteral(expression)) {
        return flat;
      }
      const rendered = printRustExprFitted(
        expression.expr,
        depth,
        column + prefix.length + (parenthesized ? 1 : 0),
      );
      if (!parenthesized && rendered.includes("\n") &&
        expression.expr.kind === "try" && expression.expr.expr.kind === "method-call") {
        const chain = rustMethodChain(expression.expr.expr);
        if (chain !== undefined) {
          const selectorCount = chain.steps.filter((step) =>
            step.kind === "method" || step.kind === "field" || step.kind === "await").length;
          if (selectorCount === 1) {
            const attached = appendToLastLine(
              printFittedMethodChain(
                chain,
                depth,
                column + prefix.length + 1,
                false,
                indentText(depth + 1),
                true,
              ),
              "?",
            );
            if (renderedFits(attached, column + prefix.length)) {
              return `${prefix}${attached}`;
            }
          }
          const expanded = appendToLastLine(
            printFittedMethodChain(
              chain,
              depth,
              column + prefix.length + 1,
              true,
              indentText(depth + 1),
            ),
            "?",
          );
          return `${prefix}${expanded}`;
        }
      }
      return `${prefix}${parenthesized ? `(${rendered})` : rendered}`;
    }
    case "numeric-cast": {
      const parenthesized = expressionNeedsParentheses(
        expression.expression,
        RustPrecedence.Cast,
        false,
      );
      const rendered = printRustExprFitted(
        expression.expression,
        depth,
        column + (parenthesized ? 1 : 0),
        methodChainContinuationIndent,
      );
      return `${parenthesized ? `(${rendered})` : rendered} as ${expression.target}`;
    }
    case "index": {
      if (!flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      const receiver = printRustExprFitted(expression.receiver, depth, column);
      const flatIndex = printRustExpr(expression.index);
      const continuation = indentText(depth + 1);
      if (!receiver.includes("\n") && !flatIndex.includes("\n") &&
        !renderedFits(`${receiver}[${flatIndex}]`, column) &&
        renderedFits(`[${flatIndex}]`, continuation.length)) {
        return `${receiver}\n${continuation}[${flatIndex}]`;
      }
      const opening = appendToLastLine(receiver, "[");
      const index = printRustExprFitted(
        expression.index,
        depth,
        lastLineLength(opening),
      );
      return appendToLastLine(`${opening}${index}`, "]");
    }
    case "unary": {
      const operand = printRustExprFitted(expression.operand, depth, column + 1);
      if (operand.includes("\n") && expression.operand.kind === "try" &&
        expression.operand.expr.kind === "method-call") {
        const chain = rustMethodChain(expression.operand.expr);
        if (chain !== undefined) {
          return `${expression.operator}${appendToLastLine(
            printFittedMethodChain(
              chain,
              depth,
              column + 2,
              true,
              indentText(depth + 1),
            ),
            "?",
          )}`;
        }
      }
      return expressionPrecedence(expression.operand) < RustPrecedence.Unary
        ? `${expression.operator}(${operand})`
        : `${expression.operator}${operand}`;
    }
    case "binary": {
      const leftMethodChain = rustMethodChain(expression.left);
      const leftMethodRequiresExpansion = leftMethodChain !== undefined &&
        methodChainContinuationIndent !== undefined &&
        rustMethodChainFirstMethodRequiresExpansion(leftMethodChain, depth);
      if (!rustExpressionContainsStatementBlock(expression) &&
        !rustExpressionContainsExpandedStructLiteral(expression) &&
        !rustMethodChainPrefersVerticalLayout(expression.left) &&
        !rustMethodChainPrefersVerticalLayout(expression.right) &&
        !rustBinaryOperandPrefersExpandedCall(expression.left) &&
        !rustDirectBinaryCallExceedsCallWidth(expression.left) &&
        !leftMethodRequiresExpansion &&
        !flat.includes("\n") && renderedFits(flat, column)) {
        return flat;
      }
      if (expression.operator === "||" || expression.operator === "&&") {
        return printFittedLogicalChain(
          expression,
          expression.operator,
          depth,
          column,
          grammarPosition,
        );
      }
      if (expression.left.kind === "binary" &&
        expression.left.operator === expression.operator) {
        return printFittedLeftAssociativeBinaryChain(
          expression,
          expression.operator,
          depth,
          column,
          grammarPosition,
        );
      }
      const directLeftCall = rustDirectBinaryCall(expression.left);
      const expandedLeftCall = directLeftCall?.kind === "call"
        ? printExpandedBinaryLeftCall(
            directLeftCall,
            printRustDirectCallTarget(directLeftCall),
            expression.operator,
            expression.right,
            depth,
            column,
            layoutRegion !== "logical-chain-operand",
            rustBinaryOperandPrefersExpandedCall(expression.left),
          )
        : directLeftCall?.kind === "associated-call"
          ? printExpandedBinaryLeftCall(
              directLeftCall,
              printRustAssociatedCallTarget(
                directLeftCall,
                printRustAssociatedCallOwner(directLeftCall),
              ),
              expression.operator,
              expression.right,
              depth,
              column,
              layoutRegion !== "logical-chain-operand",
              rustBinaryOperandPrefersExpandedCall(expression.left),
            )
          : undefined;
      const leftNeedsBinarySlotLayout = leftMethodChain !== undefined &&
        (leftMethodRequiresExpansion ||
          rustMethodChainPrefersVerticalLayout(expression.left) ||
          !renderedFits(flat, column) &&
          leftMethodChain.steps.filter((step) =>
            step.kind === "method" || step.kind === "field" || step.kind === "await").length > 1);
      const leftSelectorCount = leftMethodChain?.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
      const binarySlotBreaksBeforeFirstSelector = leftMethodChain !== undefined &&
        (rustMethodChainBreaksReceiverWhenExpanded(leftMethodChain) ||
          leftSelectorCount > 1 && leftMethodChain.steps[0]?.kind === "method" &&
            rustMethodChainContainsClosure(leftMethodChain));
      const renderedLeft = expandedLeftCall ?? (leftNeedsBinarySlotLayout
        ? printFittedMethodChain(
            leftMethodChain,
            depth,
            column,
            binarySlotBreaksBeforeFirstSelector,
            methodChainContinuationIndent ?? indentText(depth + 1),
          )
        : expression.left.kind === "try" &&
          (expression.left.expr.kind === "call" || expression.left.expr.kind === "associated-call") &&
          expression.left.expr.args.length > 1 &&
          (rustBinaryOperandPrefersExpandedCall(expression.left) ||
            !renderedFits(printRustExpr(expression.left), column))
        ? printNestedCallArgument(expression.left, depth, column, true)
        : printRustExprFitted(
            expression.left,
            depth,
            column,
            methodChainContinuationIndent ??
              (column > indentText(depth).length ? indentText(depth + 1) : undefined),
            grammarPosition,
          ));
      let left = printFittedBinaryOperand(
        expression.left,
        renderedLeft,
        expression.operator,
        false,
        grammarPosition === "statement" && expressionIsStatementBlockOperand(expression.left),
      );
      if (expression.right.kind === "match") {
        if (expression.left.kind === "match" && left.includes("\n")) {
          const renderedRight = printFittedBinaryOperand(
            expression.right,
            printRustExprFitted(
              expression.right,
              depth,
              lastLineLength(left) + expression.operator.length + 2,
            ),
            expression.operator,
            true,
          );
          const attached = appendToLastLine(
            left,
            ` ${expression.operator} ${firstLine(renderedRight)}`,
          );
          const rest = remainingLines(renderedRight);
          return rest.length === 0 ? attached : `${attached}\n${rest.join("\n")}`;
        }
        const continuationIndent = indentText(depth + 1);
        const continuedRight = printFittedBinaryOperand(
          expression.right,
          printRustExprFitted(
            expression.right,
            depth + 1,
            continuationIndent.length + expression.operator.length + 1,
          ),
          expression.operator,
          true,
        );
        const continuation = `${continuationIndent}${expression.operator} ${firstLine(continuedRight)}`;
        return remainingLines(continuedRight).length === 0
          ? `${left}\n${continuation}`
          : `${left}\n${continuation}\n${remainingLines(continuedRight).join("\n")}`;
      }
      if (!left.includes("\n") && expressionIsRightHandBlock(expression.right)) {
        const separator = ` ${expression.operator} `;
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          column + left.length + separator.length,
        );
        return `${left}${separator}${renderedRight}`;
      }
      if (left.includes("\n") &&
        (expression.left.kind === "call" || expression.left.kind === "associated-call") &&
        (expression.right.kind === "call" || expression.right.kind === "associated-call")) {
        const separator = ` ${expression.operator} `;
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          lastLineLength(left) + separator.length,
        );
        const attached = appendToLastLine(left, `${separator}${renderedRight}`);
        if (renderedFits(attached, column)) {
          return attached;
        }
      }
      if ((left.includes("\n") || column + left.length >= rustFormatWidth - 1) &&
        expression.left.kind === "try" && expression.left.expr.kind === "method-call" &&
        !(expression.left.expr.args.length === 1 &&
          expression.left.expr.args[0]?.kind === "tuple-literal")) {
        const chain = rustMethodChain(expression.left.expr);
        if (chain !== undefined) {
          left = printFittedBinaryOperand(
            expression.left,
            appendToLastLine(printFittedMethodChain(
              chain,
              depth,
              column + 1,
              true,
              methodChainContinuationIndent ?? indentText(depth + 1),
            ), "?"),
            expression.operator,
            false,
          );
        }
      }
      const joined = appendToLastLine(
        left,
        ` ${expression.operator} ${printBinaryOperand(expression.right, expression.operator, true)}`,
      );
      if (left.includes("\n") && expressionIsStatementBlockOperand(expression.left)) {
        const renderedRight = printRustExprFitted(
          expression.right,
          depth,
          lastLineLength(left) + expression.operator.length + 2,
        );
        return appendToLastLine(left, ` ${expression.operator} ${renderedRight}`);
      }
      const multilineLeftChain = rustMethodChain(expression.left);
      const multilineLeftClosureStartsOnFirstLine = multilineLeftChain !== undefined &&
        rustMethodChainContainsClosure(multilineLeftChain) &&
        firstLine(left).trimEnd().endsWith("{");
      const multilineLeftRequiresOwnOperator = left.includes("\n") &&
        (expression.left.kind === "binary" || expression.left.kind === "index" ||
          multilineLeftChain !== undefined &&
            (multilineLeftChain.base.kind === "match" ||
              !multilineLeftClosureStartsOnFirstLine &&
                !firstLine(left).trimEnd().endsWith("(")));
      if (!multilineLeftRequiresOwnOperator && renderedFits(joined, column)) {
        return joined;
      }
      const continuationIndent = indentText(depth + 1);
      const renderedRight = printRustExprFitted(
        expression.right,
        depth + 1,
        continuationIndent.length + expression.operator.length + 1,
      );
      const right = printFittedBinaryOperand(
        expression.right,
        renderedRight,
        expression.operator,
        true,
      );
      const continuation = `${continuationIndent}${expression.operator} ${firstLine(right)}`;
      return remainingLines(right).length === 0
        ? `${left}\n${continuation}`
        : `${left}\n${continuation}\n${remainingLines(right).join("\n")}`;
    }
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return printRustCollectionLiteralFitted(
        expression,
        depth,
        column,
        (element, elementDepth, elementColumn) => printRustExprFitted(
          element,
          elementDepth,
          elementColumn,
          undefined,
          "expression",
          "vertical-call-argument",
        ),
      );
    case "struct-literal":
      return printRustStructLiteralFitted(expression, depth, column, printRustExprFitted);
    default:
      return flat;
  }
}

function rustDirectBinaryCallExceedsCallWidth(expression: RustExpr): boolean {
  const call = rustDirectBinaryCall(expression);
  return call !== undefined && call.args.length > 1 &&
    call.args.map(printRustExpr).join(", ").length > rustNestedCallWidth;
}

function rustDirectBinaryCall(
  expression: RustExpr,
): Extract<RustExpr, { readonly kind: "call" | "associated-call" }> | undefined {
  return expression.kind === "bottom"
    ? rustDirectBinaryCall(expression.expression)
    : expression.kind === "call" || expression.kind === "associated-call"
      ? expression
      : undefined;
}
