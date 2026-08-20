import { appendToLastLine, firstLine, lastLine, lastLineLength, remainingLines, renderedFits, rustExpressionContainsTry } from "../patterns.js";
import { expressionIsStatementBlockOperand, expressionPrecedence, operatorPrecedence, printFittedBinaryOperand, printOperand, RustPrecedence } from "./precedence.js";
import { indentText, printRustType } from "../types.js";
import { printFittedCall } from "./calls.js";
import { printRustAssociatedCallTarget, printRustCallMember, printRustDirectCallTarget, printRustMethodCallTarget } from "./callable.js";
import { printRustExpr, rustExpressionContainsClosure } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustExpressionContainsExpandedStructLiteral, rustFormatArgumentIsAtomic } from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/rust-ast/expressions.js";
import { rustFormatWidth, rustInlineClosureFieldReceiverWidth, rustInlineFieldReceiverWidth, rustMethodChainWidth, rustNestedCallWidth } from "../formatting.js";
import type { RustExpr, RustType } from "../../../backend/rust-ast/nodes.js";
import type { RustExpressionGrammarPosition } from "./precedence.js";

export function printRustSingleCollectionCallContinuation(
  initializer: RustExpr,
  depth: number,
  column: number,
): string | undefined {
  const invocation = initializer.kind === "call"
    ? {
        callable: printRustDirectCallTarget(initializer),
        arguments: initializer.args,
      }
    : initializer.kind === "associated-call"
      ? {
          callable: printRustAssociatedCallTarget(initializer, printRustAssociatedOwner(initializer.owner)),
          arguments: initializer.args,
        }
      : undefined;
  const argument = invocation?.arguments.length === 1
    ? invocation.arguments[0]
    : undefined;
  if (invocation === undefined || argument === undefined ||
    (argument.kind !== "vec-literal" && argument.kind !== "slice-literal") ||
    argument.elements.length !== 1) {
    return undefined;
  }
  const flat = printRustExpr(initializer);
  const argumentFlat = printRustExpr(argument);
  const argumentIndent = indentText(depth + 1);
  if (flat.includes("\n") || argumentFlat.includes("\n") ||
    renderedFits(`${flat};`, column) ||
    !renderedFits(`${invocation.callable}(`, column) ||
    !renderedFits(`${argumentFlat},`, argumentIndent.length)) {
    return undefined;
  }
  return [
    `${invocation.callable}(`,
    `${argumentIndent}${argumentFlat},`,
    `${indentText(depth)})`,
  ].join("\n");
}

export function printRustFlatLetInitializer(
  prefix: string,
  initializer: string,
  depth: number,
): string {
  const assignment = `${prefix}${initializer};`;
  return renderedFits(assignment, 0)
    ? assignment
    : `${prefix.trimEnd()}\n${indentText(depth + 1)}${initializer};`;
}

export function printRustAssociatedOwner(owner: RustType): string {
  if (owner.kind !== "named" || owner.typeArguments === undefined || owner.typeArguments.length === 0) {
    return printRustType(owner);
  }
  return `${owner.path}::<${owner.typeArguments.map(printRustType).join(", ")}>`;
}

export function printFittedLogicalChain(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  operator: "||" | "&&",
  depth: number,
  column: number,
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const operands: RustExpr[] = [];
  collectLogicalOperands(expression, operator, operands);
  const first = operands[0];
  if (first === undefined) {
    return printRustExpr(expression);
  }
  const second = operands[1];
  const firstFlat = printRustExpr(first);
  const firstParenthesized = expressionPrecedence(first) < operatorPrecedence(operator) ||
    grammarPosition === "statement" && expressionIsStatementBlockOperand(first);
  const firstFlatOperand = firstParenthesized ? `(${firstFlat})` : firstFlat;
  let rendered = operands.length === 2 && second !== undefined &&
      rustExpressionContainsStatementBlock(second) &&
      !firstFlat.includes("\n") &&
      renderedFits(`${firstFlatOperand} ${operator} {`, column)
    ? firstFlatOperand
    : printFittedLogicalOperand(
        first,
        operator,
        depth,
        column,
        grammarPosition,
      );
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const attachedToClosingBlock = lastLine(rendered).trim() === "}";
    if (operands.length === 2 && !rendered.includes("\n") &&
      rustExpressionContainsStatementBlock(operand)) {
      const separator = ` ${operator} `;
      const attachedRight = printFittedLogicalOperand(
        operand,
        operator,
        depth,
        column + rendered.length + separator.length,
        "expression",
      );
      if (firstLine(attachedRight).trimStart().startsWith("{") &&
        column + rendered.length + separator.length + firstLine(attachedRight).length <=
        rustFormatWidth) {
        rendered = `${rendered}${separator}${attachedRight}`;
        continue;
      }
    }
    const operandDepth = rustExpressionContainsStatementBlock(operand) && attachedToClosingBlock
      ? depth
      : depth + 1;
    const right = printFittedLogicalOperand(
      operand,
      operator,
      operandDepth,
      continuationIndent.length + operator.length + 1,
      "expression",
    );
    const continuation = `${operator} ${firstLine(right)}`;
    rendered = attachedToClosingBlock
      ? appendToLastLine(rendered, ` ${continuation}`)
      : `${rendered}\n${continuationIndent}${continuation}`;
    const rest = remainingLines(right);
    if (rest.length > 0) {
      rendered += `\n${rest.join("\n")}`;
    }
  }
  return rendered;
}

export function printFittedLeftAssociativeBinaryChain(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  operator: string,
  depth: number,
  column: number,
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const operands: RustExpr[] = [];
  collectLeftAssociativeBinaryOperands(expression, operator, operands);
  const first = operands[0];
  if (first === undefined) {
    return printRustExpr(expression);
  }
  let rendered = printRustExprFitted(first, depth, column, undefined, grammarPosition);
  const continuationIndent = indentText(depth + 1);
  for (const operand of operands.slice(1)) {
    const right = printFittedBinaryOperand(
      operand,
      printRustExprFitted(
        operand,
        depth + 1,
        continuationIndent.length + operator.length + 1,
      ),
      operator,
      true,
    );
    rendered += `\n${continuationIndent}${operator} ${firstLine(right)}`;
    const rest = remainingLines(right);
    if (rest.length > 0) {
      rendered += `\n${rest.join("\n")}`;
    }
  }
  return rendered;
}

function collectLeftAssociativeBinaryOperands(
  expression: RustExpr,
  operator: string,
  operands: RustExpr[],
): void {
  if (expression.kind === "binary" && expression.operator === operator) {
    collectLeftAssociativeBinaryOperands(expression.left, operator, operands);
    operands.push(expression.right);
    return;
  }
  operands.push(expression);
}

function printFittedLogicalOperand(
  operand: RustExpr,
  operator: "||" | "&&",
  depth: number,
  column: number,
  grammarPosition: RustExpressionGrammarPosition,
): string {
  const parenthesized = expressionPrecedence(operand) < operatorPrecedence(operator) ||
    grammarPosition === "statement" && expressionIsStatementBlockOperand(operand);
  const selectedColumn = column + (parenthesized ? 1 : 0);
  const rendered = printRustVerticalMethodChainSlot(
    operand,
    depth,
    selectedColumn,
  ) ?? printRustExprFitted(
      operand,
      depth,
      selectedColumn,
      undefined,
      grammarPosition,
    );
  return parenthesized ? `(${rendered})` : rendered;
}

function collectLogicalOperands(
  expression: RustExpr,
  operator: "||" | "&&",
  operands: RustExpr[],
): void {
  if (expression.kind === "binary" && expression.operator === operator) {
    collectLogicalOperands(expression.left, operator, operands);
    collectLogicalOperands(expression.right, operator, operands);
    return;
  }
  operands.push(expression);
}

interface RustMethodChain {
  readonly base: RustExpr;
  readonly steps: readonly RustMethodChainStep[];
}

type RustMethodChainStep =
  | {
      readonly kind: "method";
      readonly name: string;
      readonly typeArguments?: readonly RustType[];
      readonly args: readonly RustExpr[];
    }
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "await" }
  | { readonly kind: "try" };

export function rustMethodChain(expression: RustExpr): RustMethodChain | undefined {
  const steps: RustMethodChainStep[] = [];
  const base = collectRustMethodChain(expression, steps);
  return steps.some((step) => step.kind === "method") ? { base, steps } : undefined;
}

export function rustMethodChainRequiresVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  const expandedClosureOpening = rustExpandedMethodClosureOpeningWidth(expression);
  const renderedLength = printRustExpr(expression).length;
  return chain !== undefined &&
    (expandedClosureOpening === undefined || expandedClosureOpening > rustMethodChainWidth) &&
    (expression.kind === "try"
      ? renderedLength >= rustMethodChainWidth
      : renderedLength > rustMethodChainWidth) &&
    chain.steps.filter((step) =>
      step.kind === "method" || step.kind === "field" || step.kind === "await").length > 1;
}

export function rustExpandedMethodClosureOpeningWidth(
  expression: RustExpr,
  depth = 0,
  column = 0,
): number | undefined {
  if (expression.kind !== "method-call") {
    return undefined;
  }
  const trailing = expression.args[expression.args.length - 1];
  if (trailing?.kind !== "closure" && trailing?.kind !== "closure-block") {
    return undefined;
  }
  const preceding = expression.args.slice(0, -1).map(printRustExpr);
  if (preceding.some((argument) => argument.includes("\n"))) {
    return 0;
  }
  const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
  const prefix = `${printRustMethodCallTarget(expression, receiver)}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
  const renderedClosure = printRustExprFitted(trailing, depth, column + prefix.length);
  return renderedClosure.includes("\n")
    ? prefix.length + firstLine(renderedClosure).length + 1
    : undefined;
}
export function rustMethodCallKeepsTrailingClosureAttached(
  expression: RustExpr,
  depth: number,
  column: number,
): boolean {
  if (expression.kind !== "method-call") {
    return false;
  }
  const trailing = expression.args[expression.args.length - 1];
  if (trailing?.kind !== "closure" && trailing?.kind !== "closure-block") {
    return false;
  }
  const preceding = expression.args.slice(0, -1).map(printRustExpr);
  if (preceding.some((argument) => argument.includes("\n"))) {
    return false;
  }
  const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
  const method = printRustCallMember(expression.method, expression.typeArguments);
  const prefix = `${receiver}.${method}(${preceding.length === 0 ? "" : `${preceding.join(", ")}, `}`;
  const renderedClosure = printRustExprFitted(
    trailing,
    depth,
    column + prefix.length,
  );
  if (trailing.kind === "closure" && renderedClosure.includes("\n")) {
    const flatClosure = printRustExpr(trailing);
    const continuationWidth = indentText(depth + 1).length + method.length +
      (preceding.length === 0 ? 3 : preceding.join(", ").length + 5) + flatClosure.length;
    const bodyChain = rustMethodChain(trailing.body);
    const complexBody = bodyChain !== undefined &&
      bodyChain.steps.filter((step) =>
        step.kind === "method" || step.kind === "field" || step.kind === "await").length >= 3;
    if (!complexBody && !flatClosure.includes("\n") && continuationWidth <= rustFormatWidth) {
      return false;
    }
  }
  const closureOpening = firstLine(renderedClosure);
  const openingWidth = prefix.length + closureOpening.length + 1;
  return column + openingWidth <= rustFormatWidth;
}

export function rustMethodChainPrefersVerticalLayout(expression: RustExpr): boolean {
  const chain = rustMethodChain(expression);
  return rustMethodChainRequiresVerticalLayout(expression) ||
    chain !== undefined && printRustExpr(expression).length > rustNestedCallWidth &&
    chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
      argument.kind !== "closure" && argument.kind !== "closure-block" && argument.kind !== "block" &&
      rustExpressionContainsClosure(argument)));
}

export function rustBinaryOperandPrefersExpandedCall(expression: RustExpr): boolean {
  const call = expression.kind === "call" || expression.kind === "associated-call" ||
      expression.kind === "invoke"
    ? expression
    : expression.kind === "try" &&
        (expression.expr.kind === "call" || expression.expr.kind === "associated-call" ||
          expression.expr.kind === "invoke")
      ? expression.expr
      : undefined;
  if (call === undefined || call.args.length <= 1) {
    return false;
  }
  const trailing = call.args[call.args.length - 1];
  const selectionArguments = trailing?.kind === "closure" &&
      rustFormatArgumentIsAtomic(trailing.body)
    ? call.args.slice(0, -1)
    : call.args;
  return selectionArguments.some((argument) =>
      rustExpressionContainsTry(argument) || rustExpressionContainsClosure(argument)) &&
    printRustExpr(expression).length > rustNestedCallWidth;
}

export function rustMethodChainBreaksReceiverWhenExpanded(chain: RustMethodChain): boolean {
  const first = chain.steps[0];
  const selectorCount = chain.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length;
  const firstSelectorWidth = first?.kind === "method"
    ? printRustCallMember(first.name, first.typeArguments).length + 1
    : first?.kind === "field"
      ? first.name.length + 1
      : first?.kind === "await" ? ".await".length
      : first?.kind === "try" ? 1 : 0;
  const laterFallibleArgument = chain.steps.some((step, index) =>
    index > 0 && step.kind === "method" && step.args.some(rustExpressionContainsTry));
  return selectorCount > 1 && laterFallibleArgument ||
    printRustExpr(chain.base).length + firstSelectorWidth > rustMethodChainWidth ||
    chain.steps.some((step, index) =>
      step.kind === "try" && chain.steps[index + 1]?.kind === "method");
}

export function rustMethodChainFirstSegmentWidth(chain: RustMethodChain): number {
  let width = printRustExpr(chain.base).length;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      width += 1;
      continue;
    }
    if (step.kind === "await") {
      width += ".await".length;
      continue;
    }
    if (step.kind === "field") {
      width += step.name.length + 1;
      continue;
    }
    return width + printRustCallMember(step.name, step.typeArguments).length +
      step.args.map(printRustExpr).join(", ").length + 3;
  }
  return width;
}

export function rustMethodChainFirstMethodRequiresExpansion(
  chain: RustMethodChain,
  depth: number,
): boolean {
  const firstMethod = chain.steps.find((step) => step.kind === "method");
  if (firstMethod === undefined || firstMethod.kind !== "method") {
    return false;
  }
  const continuationIndent = indentText(depth + 1);
  return printFittedCall(
    `.${printRustCallMember(firstMethod.name, firstMethod.typeArguments)}`,
    firstMethod.args,
    depth + 1,
    continuationIndent.length + 1,
  ).includes("\n");
}

export function rustMethodChainContainsClosure(chain: RustMethodChain): boolean {
  return chain.steps.some((step) => step.kind === "method" && step.args.some((argument) =>
    argument.kind === "closure" || argument.kind === "closure-block"));
}

function rustMethodChainLastSelectorWidth(chain: RustMethodChain): number {
  let selector: Exclude<RustMethodChainStep, { readonly kind: "try" }> | undefined;
  for (let index = chain.steps.length - 1; index >= 0; index -= 1) {
    const step = chain.steps[index];
    if (step !== undefined && step.kind !== "try") {
      selector = step;
      break;
    }
  }
  if (selector === undefined) {
    return 0;
  }
  if (selector.kind === "field") {
    return selector.name.length + 1;
  }
  if (selector.kind === "await") {
    return ".await".length;
  }
  return printRustCallMember(selector.name, selector.typeArguments).length +
    selector.args.map(printRustExpr).join(", ").length + 3;
}

function printRustMethodChain(chain: RustMethodChain): string {
  let rendered = printRustExpr(chain.base);
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered += "?";
    } else if (step.kind === "await") {
      rendered += ".await";
    } else if (step.kind === "field") {
      rendered += `.${step.name}`;
    } else {
      rendered += `.${printRustCallMember(step.name, step.typeArguments)}(${step.args.map(printRustExpr).join(", ")})`;
    }
  }
  return rendered;
}

export function rustMethodChainBreaksReceiverForClosure(
  chain: RustMethodChain,
  flat: string,
  column: number,
): boolean {
  const selectorCount = chain.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length;
  const containsNestedClosureInSingleArgument = chain.steps.some((step) =>
    step.kind === "method" && step.args.length === 1 && step.args.some((argument) =>
      argument.kind !== "closure" && argument.kind !== "closure-block" &&
      rustExpressionContainsClosure(argument)));
  return (selectorCount > 1 && rustMethodChainContainsClosure(chain) ||
      selectorCount === 1 && containsNestedClosureInSingleArgument) &&
    (!renderedFits(flat, column) ||
      flat.length > rustMethodChainWidth &&
        rustMethodChainLastSelectorWidth(chain) <= rustMethodChainWidth);
}

function collectRustMethodChain(expression: RustExpr, steps: RustMethodChainStep[]): RustExpr {
  if (expression.kind === "method-call") {
    const base = collectRustMethodChain(expression.receiver, steps);
    steps.push({
      kind: "method",
      name: expression.method,
      ...(expression.typeArguments === undefined
        ? {}
        : { typeArguments: expression.typeArguments }),
      args: expression.args,
    });
    return base;
  }
  if (expression.kind === "try") {
    const base = collectRustMethodChain(expression.expr, steps);
    steps.push({ kind: "try" });
    return base;
  }
  if (expression.kind === "await") {
    const base = collectRustMethodChain(expression.expr, steps);
    steps.push({ kind: "await" });
    return base;
  }
  if (expression.kind === "field") {
    const base = collectRustMethodChain(expression.receiver, steps);
    steps.push({ kind: "field", name: expression.name });
    return base;
  }
  return expression;
}

export function printFittedMethodChain(
  chain: RustMethodChain,
  depth: number,
  column: number,
  breakBeforeFirstSelector = false,
  continuationIndent = indentText(depth + 1),
  forceAttachFirstSelector = false,
): string {
  const flatBase = printRustExpr(chain.base);
  const flatChain = printRustMethodChain(chain);
  const selectedBreakBeforeFirstSelector = breakBeforeFirstSelector ||
    rustMethodChainBreaksReceiverForClosure(chain, flatChain, column);
  let rendered = !flatBase.includes("\n") && renderedFits(flatBase, column) &&
      !rustExpressionContainsExpandedStructLiteral(chain.base)
    ? flatBase
    : printRustExprFitted(chain.base, depth, column);
  const selectedContinuationIndent = rendered.includes("\n")
    ? indentText(depth)
    : continuationIndent;
  const breakBeforeFirstField = selectedBreakBeforeFirstSelector;
  let emittedCall = false;
  let emittedField = false;
  for (const step of chain.steps) {
    if (step.kind === "try") {
      rendered = appendToLastLine(rendered, "?");
      continue;
    }
    if (step.kind === "await") {
      rendered = emittedCall || rendered.includes("\n") ||
          column + lastLineLength(rendered) + ".await".length >= rustMethodChainWidth
        ? `${rendered}\n${selectedContinuationIndent}.await`
        : appendToLastLine(rendered, ".await");
      continue;
    }
    if (step.kind === "field") {
      const attachInitialField = !emittedCall && !emittedField &&
        !rendered.includes("\n") &&
        (forceAttachFirstSelector ||
          rustMethodChainContainsClosure(chain) &&
            lastLineLength(rendered) + step.name.length + 1 <=
              rustInlineClosureFieldReceiverWidth);
      rendered = !attachInitialField && (breakBeforeFirstField || emittedCall || rendered.includes("\n") ||
          lastLineLength(rendered) + step.name.length + 1 > rustInlineFieldReceiverWidth
        )
          ? `${rendered}\n${selectedContinuationIndent}.${step.name}`
          : appendToLastLine(rendered, `.${step.name}`);
      emittedField = true;
      continue;
    }
    const inlineMethod = printFittedCall(
      `.${printRustCallMember(step.name, step.typeArguments)}`,
      step.args,
      depth,
      selectedContinuationIndent.length + 1,
      false,
      false,
      depth,
    );
    const inlineFirstMethod = !selectedBreakBeforeFirstSelector && !emittedCall &&
      !rendered.includes("\n") &&
      (forceAttachFirstSelector ||
        (inlineMethod.includes("\n")
          ? renderedFits(`${rendered}.${printRustCallMember(step.name, step.typeArguments)}(`, column)
          : renderedFits(`${rendered}${inlineMethod}`, column)));
    const method = inlineFirstMethod
      ? inlineMethod
      : printFittedCall(
          `.${printRustCallMember(step.name, step.typeArguments)}`,
          step.args,
          depth + 1,
          selectedContinuationIndent.length + 1,
          false,
          false,
          depth,
        );
    rendered = inlineFirstMethod
      ? appendToLastLine(rendered, method)
      : `${rendered}\n${selectedContinuationIndent}${method}`;
    emittedCall = true;
  }
  return rendered;
}

export function printRustVerticalMethodChainSlot(
  expression: RustExpr,
  depth: number,
  column: number,
  continuationIndent = indentText(depth + 1),
): string | undefined {
  const chain = rustMethodChain(expression);
  return chain !== undefined && rustMethodChainPrefersVerticalLayout(expression)
    ? printFittedMethodChain(chain, depth, column, true, continuationIndent)
    : undefined;
}
