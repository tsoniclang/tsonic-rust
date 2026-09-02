import { appendToLastLine, firstLine, renderedFits } from "../patterns.js";
import { indentText, printRustGenericArgument, printRustType } from "../types.js";
import { printRustAssociatedOwner, printRustSingleCollectionCallContinuation, rustMethodChain, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printRustClosureParams } from "./closure-params.js";
import { printRustExpr } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustCompactInitializerWidth, rustCompactTrailingClosureWidth, rustFormatWidth, rustMethodChainWidth, rustNestedCallWidth, rustSingleLineConditionalWidth } from "../formatting.js";
import { rustExpressionContainsExpandedCollectionLiteral, rustExpressionContainsExpandedStructLiteral, rustFormatArgumentCanShareLine, rustFormatArgumentIsAtomic, rustInvocationHasNestedExpandedCollection } from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import type { RustExpr, RustType } from "../../../backend/target-ast/nodes.js";

export function printRustClosureFitted(
  expression: Extract<RustExpr, { readonly kind: "closure" }>,
  depth: number,
  column: number,
  forceBlock = false,
): string {
  const flat = printRustExpr(expression);
  const bodyChain = rustMethodChain(expression.body);
  const bodySelectorCount = bodyChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  const bodyHasLongMethodChain = bodyChain !== undefined &&
    bodySelectorCount >= 3 &&
    flat.length > rustNestedCallWidth;
  if (!forceBlock && !flat.includes("\n") && renderedFits(flat, column) &&
    !bodyHasLongMethodChain &&
    !rustMethodChainPrefersVerticalLayout(expression.body) &&
    !rustExpressionContainsStatementBlock(expression.body)) {
    return flat;
  }
  const params = printRustClosureParams(expression.params);
  const prefix = `${expression.move === true ? "move " : ""}|${params}|`;
  const indent = indentText(depth + 1);
  if (expression.params.length === 0 &&
    (expression.body.kind === "match" || expression.body.kind === "conditional")) {
    const body = printRustExprFitted(
      expression.body,
      depth,
      column + prefix.length + 1,
    );
    const direct = `${prefix} ${body}`;
    if (renderedFits(direct, column)) {
      return direct;
    }
  }
  if (expression.body.kind === "block") {
    const bindings = expression.body.bindings.flatMap((binding) => {
      const prefix = `${indent}let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = `;
      return [
        ...(binding.attrs ?? []).map((attribute) => `${indent}${attribute}`),
        printRustLetInitializer(prefix, binding.value, depth + 1),
      ];
    });
    const value = printRustExprFitted(
      expression.body.value,
      depth + 1,
      indent.length,
      undefined,
      "statement",
    );
    return [
      `${prefix} {`,
      ...bindings,
      `${indent}${value}`,
      `${indentText(depth)}}`,
    ].join("\n");
  }
  const body = printRustExprFitted(
    expression.body,
    depth + 1,
    indent.length,
  );
  return [`${prefix} {`, `${indent}${body}`, `${indentText(depth)}}`].join("\n");
}

export function printRustConditionalArmInline(expression: RustExpr): string {
  return expression.kind === "block"
    ? printRustBlockExpressionInlineContents(expression)
    : printRustExpr(expression);
}

export function printRustBlockExpressionInlineContents(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
): string {
  const bindings = expression.bindings.map((binding) => {
    const attributes = binding.attrs?.join(" ") ?? "";
    const declaration = `let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = ${printRustExpr(binding.value)};`;
    return attributes.length === 0 ? declaration : `${attributes} ${declaration}`;
  });
  return [
    ...(expression.innerAttrs ?? []),
    ...bindings,
    printRustExpr(expression.value),
  ].join(" ");
}

export function printRustConditionalArmLines(
  expression: RustExpr,
  depth: number,
): readonly string[] {
  if (expression.kind === "block") {
    return printRustBlockExpressionLines(expression, depth);
  }
  const indent = indentText(depth);
  const flat = printRustExpr(expression);
  if (expression.kind === "conditional" &&
    flat.length <= rustSingleLineConditionalWidth && renderedFits(flat, indent.length)) {
    return [`${indent}${flat}`];
  }
  return [`${indent}${printRustExprFitted(
    expression,
    depth,
    indent.length,
    undefined,
    "statement",
    "block-arm",
  )}`];
}

export function printRustBlockExpressionLines(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
  depth: number,
): readonly string[] {
  const indent = indentText(depth);
  const bindings = expression.bindings.flatMap((binding) => {
    const prefix = `${indent}let ${binding.mutable === true ? "mut " : ""}${binding.name}${binding.type === undefined ? "" : `: ${printRustType(binding.type)}`} = `;
    return [
      ...(binding.attrs ?? []).map((attribute) => `${indent}${attribute}`),
      printRustLetInitializer(prefix, binding.value, depth),
    ];
  });
  const value = printRustExprFitted(
    expression.value,
    depth,
    indent.length,
    undefined,
    "statement",
  );
  return [
    ...(expression.innerAttrs ?? []).map((attribute) => `${indent}${attribute}`),
    ...bindings,
    `${indent}${value}`,
  ];
}

export function printRustAssociatedCallOwner(
  expression: Extract<RustExpr, { readonly kind: "associated-call" }>,
): string {
  return expression.trait === undefined
    ? printRustAssociatedOwner(expression.owner)
    : `<${printRustType(expression.owner)} as ${printRustType(expression.trait)}>`;
}

export function printRustAssociatedCallOwnerFitted(
  expression: Extract<RustExpr, { readonly kind: "associated-call" }>,
  depth: number,
  column: number,
): string {
  if (expression.trait !== undefined) {
    return printRustAssociatedCallOwner(expression);
  }
  return printRustAssociatedOwnerFitted(expression.owner, depth, column);
}

export function printRustAssociatedOwnerFitted(
  owner: RustType,
  depth: number,
  column: number,
): string {
  if (owner.kind !== "named" || owner.genericArguments === undefined ||
    owner.genericArguments.length === 0) {
    return printRustType(owner);
  }
  const flat = printRustAssociatedOwner(owner);
  if (renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  const arguments_ = owner.genericArguments.map((argument) => {
    const rendered = argument.kind === "type"
      ? printRustTypeFitted(argument.type, depth + 1, argumentIndent.length)
      : printRustGenericArgument(argument);
    return appendToLastLine(`${argumentIndent}${rendered}`, ",");
  });
  return [
    `${owner.path}::<`,
    ...arguments_,
    `${indentText(depth)}>`,
  ].join("\n");
}

export function printRustTypeFitted(
  type: RustType,
  depth: number,
  column: number,
  trailingWidth = 1,
): string {
  const flat = printRustType(type);
  const longTuple = type.kind === "tuple" && flat.length > rustMethodChainWidth;
  if (!longTuple && renderedFits(flat, column) &&
    column + flat.length + trailingWidth <= rustFormatWidth) {
    return flat;
  }
  if (type.kind === "tuple") {
    const elementIndent = indentText(depth + 1);
    return [
      "(",
      ...type.elements.map((element) =>
        appendToLastLine(
          `${elementIndent}${printRustTypeFitted(element, depth + 1, elementIndent.length)}`,
          ",",
        )),
      `${indentText(depth)})`,
    ].join("\n");
  }
  if (type.kind === "named" && type.genericArguments !== undefined &&
    type.genericArguments.length > 0) {
    const argumentIndent = indentText(depth + 1);
    return [
      `${type.path}<`,
      ...type.genericArguments.map((argument) => {
        const rendered = argument.kind === "type"
          ? printRustTypeFitted(argument.type, depth + 1, argumentIndent.length)
          : printRustGenericArgument(argument);
        return appendToLastLine(`${argumentIndent}${rendered}`, ",");
      }),
      `${indentText(depth)}>`,
    ].join("\n");
  }
  return flat;
}

export function printRustLetInitializer(
  prefix: string,
  initializer: RustExpr,
  depth: number,
): string {
  const flat = printRustExpr(initializer);
  const complexStringConcat = initializer.kind === "string-concat" &&
    flat.length > rustNestedCallWidth &&
    !initializer.parts.every(rustFormatArgumentCanShareLine);
  const fittedAtPrefix = printRustExprFitted(
    initializer,
    depth,
    initializer.kind === "conditional" || initializer.kind === "match"
      ? prefix.length
      : prefix.length + 1,
  );
  if (!flat.includes("\n") &&
    renderedFits(`${prefix}${flat};`, 0) &&
    (initializer.kind !== "conditional" || flat.length <= rustSingleLineConditionalWidth) &&
    !rustExpressionContainsStatementBlock(initializer) &&
    !rustExpressionContainsExpandedStructLiteral(initializer) &&
    (!rustMethodChainPrefersVerticalLayout(initializer) ||
      flat.length <= rustCompactInitializerWidth) &&
    !complexStringConcat &&
    !(rustMethodChain(initializer) !== undefined && flat.length > rustMethodChainWidth) &&
    !(rustMethodChain(initializer) !== undefined &&
      prefix.length + flat.length + 1 > rustFormatWidth)) {
    return `${prefix}${flat};`;
  }
  const rhsContinuationIndent = indentText(depth + 1);
  const fittedAtContinuation = printRustExprFitted(
    initializer,
    depth + 1,
    rhsContinuationIndent.length,
    undefined,
    "expression",
    "initializer-continuation",
  );
  const inlineStatement = appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  const continuationStatement = appendToLastLine(
    `${prefix.trimEnd()}\n${rhsContinuationIndent}${fittedAtContinuation}`,
    ";",
  );
  const inlineFits = renderedFits(inlineStatement, 0);
  const continuationFits = renderedFits(continuationStatement, 0);
  const rhsMethodChain = rustMethodChain(initializer);
  const rhsMethodSelectorCount = rhsMethodChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  if (rhsMethodChain !== undefined && rhsMethodSelectorCount <= 1 &&
    !flat.includes("\n") && flat.length <= rustCompactInitializerWidth &&
    !rustExpressionContainsExpandedCollectionLiteral(initializer) &&
    !rustExpressionContainsExpandedStructLiteral(initializer) &&
    renderedFits(`${prefix}${flat};`, 0)) {
    return `${prefix}${flat};`;
  }
  const rhsInvocation = initializer.kind === "try" &&
      (initializer.expr.kind === "call" || initializer.expr.kind === "invoke" ||
        initializer.expr.kind === "associated-call" || initializer.expr.kind === "method-call")
    ? initializer.expr
    : initializer;
  const rhsArguments = rhsInvocation.kind === "call" || rhsInvocation.kind === "invoke" ||
      rhsInvocation.kind === "associated-call" || rhsInvocation.kind === "method-call"
    ? rhsInvocation.args
    : undefined;
  const rhsTrailingArgument = rhsArguments?.[rhsArguments.length - 1];
  const rhsCollectionContinuation = printRustSingleCollectionCallContinuation(
    initializer,
    depth + 1,
    rhsContinuationIndent.length,
  );
  const specializedInitializerLayout = rhsMethodChain !== undefined ||
    rustInvocationHasNestedExpandedCollection(initializer) ||
    rhsCollectionContinuation !== undefined ||
    rhsTrailingArgument?.kind === "closure" ||
    rhsTrailingArgument?.kind === "closure-block" ||
    rhsTrailingArgument?.kind === "block" ||
    rhsTrailingArgument?.kind === "evaluate-then";
  if (initializer.kind === "match" && inlineFits && prefix.length <= rustNestedCallWidth) {
    return inlineStatement;
  }
  if (!specializedInitializerLayout) {
    if (inlineFits && continuationFits) {
      return rustfmtPrefersNextLine(fittedAtPrefix, fittedAtContinuation)
        ? continuationStatement
        : inlineStatement;
    }
    if (continuationFits) {
      return continuationStatement;
    }
    if (inlineFits) {
      return inlineStatement;
    }
  }
  const directContinuationIndent = indentText(depth + 1);
  const initializerIsInvocation = initializer.kind === "call" || initializer.kind === "invoke" ||
    initializer.kind === "associated-call";
  const initializerArgumentCount = initializer.kind === "call" ||
      initializer.kind === "invoke" || initializer.kind === "associated-call"
    ? initializer.args.length
    : undefined;
  if (initializerIsInvocation && !flat.includes("\n") &&
    initializerArgumentCount === 1 &&
    flat.length <= rustCompactInitializerWidth &&
    renderedFits(`${flat};`, directContinuationIndent.length)) {
    return `${prefix.trimEnd()}\n${directContinuationIndent}${flat};`;
  }
  const methodChain = rustMethodChain(initializer);
  const chainBaseAtPrefix = methodChain === undefined
    ? undefined
    : printRustExprFitted(methodChain.base, depth, prefix.length + 1);
  const longBindingPrefix = prefix.length > 40;
  const chainBaseIsInvocation = methodChain?.base.kind === "call" ||
    methodChain?.base.kind === "associated-call" || methodChain?.base.kind === "invoke";
  const chainBaseHasNestedCollectionInvocation = methodChain !== undefined &&
    rustInvocationHasNestedExpandedCollection(methodChain.base);
  const bindingLineOwnsChainBase = chainBaseAtPrefix !== undefined &&
    (chainBaseAtPrefix.includes("\n")
      ? prefix.length + firstLine(chainBaseAtPrefix).length + 1 <= rustFormatWidth &&
        !(longBindingPrefix && chainBaseIsInvocation &&
          chainBaseHasNestedCollectionInvocation)
      : prefix.length + chainBaseAtPrefix.length + 1 <= rustFormatWidth);
  const methodChainSelectorCount = methodChain?.steps.filter((step) =>
    step.kind === "method" || step.kind === "field" || step.kind === "await").length ?? 0;
  const bindingLineOwnsMultiSelectorChainBase = bindingLineOwnsChainBase &&
    methodChainSelectorCount > 1;
  const initializerInvocation = initializer.kind === "try" &&
      (initializer.expr.kind === "call" || initializer.expr.kind === "invoke" ||
        initializer.expr.kind === "associated-call" || initializer.expr.kind === "method-call")
    ? initializer.expr
    : initializer;
  const initializerArguments = initializerInvocation.kind === "call" ||
      initializerInvocation.kind === "invoke" ||
      initializerInvocation.kind === "associated-call" || initializerInvocation.kind === "method-call"
    ? initializerInvocation.args
    : undefined;
  const trailingClosure = initializerArguments?.[initializerArguments.length - 1];
  const directCallOpeningFits = (initializer.kind === "call" ||
      initializer.kind === "invoke" || initializer.kind === "associated-call") &&
    trailingClosure?.kind === "closure-block" &&
    trailingClosure.body.statements.length > 1 &&
    fittedAtPrefix.includes("\n") &&
    prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth;
  if (directCallOpeningFits) {
    return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  }
  if (trailingClosure?.kind === "closure" || trailingClosure?.kind === "closure-block") {
    const continuationIndent = indentText(depth + 1);
    const continuation = trailingClosure.kind === "closure" &&
        rustFormatArgumentCanShareLine(trailingClosure.body) &&
        !flat.includes("\n") && renderedFits(flat, continuationIndent.length)
      ? flat
      : printRustExprFitted(
          initializer,
          depth + 1,
          continuationIndent.length,
          undefined,
          "expression",
          "initializer-continuation",
        );
    const compactClosureOwnsContinuation = initializerArguments?.length === 1 ||
      trailingClosure.kind === "closure" &&
        !rustFormatArgumentIsAtomic(trailingClosure.body);
    if (compactClosureOwnsContinuation &&
      renderedFits(continuation, continuationIndent.length) &&
      !continuation.includes("\n") && !renderedFits(flat, prefix.length + 1) &&
      !bindingLineOwnsMultiSelectorChainBase) {
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
    const continuationPacksMoreSource = continuation.split("\n").length <
      fittedAtPrefix.split("\n").length;
    const compactContinuationFitsRustfmtShape =
      ((initializer.kind === "call" || initializer.kind === "invoke" ||
          initializer.kind === "associated-call" || initializer.kind === "method-call") &&
        initializer.args.length === 1 ||
        firstLine(continuation).length <= rustCompactTrailingClosureWidth);
    if (continuation.includes("\n") &&
      (continuationPacksMoreSource
        ? compactContinuationFitsRustfmtShape
        : prefix.length + firstLine(continuation).length + 1 > rustFormatWidth ||
          initializer.kind === "try" && prefix.length <= 40 &&
            prefix.length + firstLine(continuation).length + 1 >= rustFormatWidth - 5) &&
      renderedFits(continuation, continuationIndent.length)) {
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  if ((trailingClosure?.kind === "block" || trailingClosure?.kind === "evaluate-then") &&
    fittedAtPrefix.includes("\n")) {
    const continuationIndent = indentText(depth + 1);
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
      undefined,
      "expression",
      "initializer-continuation",
    );
    if (continuation.includes("\n") &&
      continuation.split("\n").length < fittedAtPrefix.split("\n").length &&
      renderedFits(continuation, continuationIndent.length)) {
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  const directClosureCallOpeningFits = (initializer.kind === "call" ||
      initializer.kind === "invoke" || initializer.kind === "associated-call") &&
    trailingClosure?.kind === "closure" &&
    fittedAtPrefix.includes("\n") &&
    !(initializer.kind === "associated-call" && flat.includes("\n") === false &&
      renderedFits(flat, indentText(depth + 1).length)) &&
    prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth;
  if (directClosureCallOpeningFits) {
    return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  }
  const expandedCollectionInitializer = fittedAtPrefix.includes("\n") &&
    (initializer.kind === "vec-literal" || initializer.kind === "slice-literal" ||
      initializer.kind === "tuple-literal");
  if (expandedCollectionInitializer) {
    return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  }
  if (fittedAtPrefix.includes("\n")) {
    const initializerHasNestedCollectionInvocation =
      rustInvocationHasNestedExpandedCollection(initializer);
    const continuationIndent = indentText(depth + 1);
    const collectionCallContinuation = printRustSingleCollectionCallContinuation(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
      undefined,
      "expression",
      "initializer-continuation",
    );
    const rustfmtPrefersContinuation = rustfmtPrefersNextLine(
      fittedAtPrefix,
      continuation,
    );
    if (!rustfmtPrefersContinuation &&
      !(longBindingPrefix && chainBaseIsInvocation &&
        chainBaseHasNestedCollectionInvocation) &&
      renderedFits(inlineStatement, 0)) {
      return inlineStatement;
    }
    const continuationCompactsBlockHeader =
      (initializer.kind === "match" || initializer.kind === "conditional") &&
      !firstLine(fittedAtPrefix).trimEnd().endsWith("{") &&
      firstLine(continuation).trimEnd().endsWith("{");
    if (continuationCompactsBlockHeader &&
      renderedFits(continuation, continuationIndent.length)) {
      return appendToLastLine(
        `${prefix.trimEnd()}\n${continuationIndent}${continuation}`,
        ";",
      );
    }
    if (collectionCallContinuation !== undefined) {
      return `${prefix.trimEnd()}\n${continuationIndent}${collectionCallContinuation};`;
    }
    const compactContinuationWidth = continuationIndent.length + firstLine(continuation).length + 1;
    const chainBaseAtContinuation = methodChain === undefined
      ? undefined
      : printRustExprFitted(
          methodChain.base,
          depth + 1,
          continuationIndent.length,
        );
    const compactContinuationLimit = methodChain === undefined
      ? rustFormatWidth
      : rustFormatWidth - 4;
    const continuationPacksMoreSource =
      !initializerHasNestedCollectionInvocation &&
        continuation.split("\n").length < fittedAtPrefix.split("\n").length &&
        (continuation.includes("\n") ||
          compactContinuationWidth <= compactContinuationLimit) ||
      longBindingPrefix &&
        (initializerHasNestedCollectionInvocation ||
          !bindingLineOwnsChainBase && chainBaseIsInvocation &&
          chainBaseHasNestedCollectionInvocation && chainBaseAtPrefix?.includes("\n") === true) ||
      longBindingPrefix && chainBaseAtPrefix?.includes("\n") === true &&
        chainBaseAtContinuation?.includes("\n") === false;
    if (continuationPacksMoreSource && renderedFits(continuation, continuationIndent.length)) {
      return appendToLastLine(
        `${prefix.trimEnd()}\n${continuationIndent}${continuation}`,
        ";",
      );
    }
    if (prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth) {
      return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
    }
    return appendToLastLine(
      `${prefix.trimEnd()}\n${continuationIndent}${continuation}`,
      ";",
    );
  }
  if (flat.includes("\n") && initializer.kind !== "match") {
    const continuationIndent = indentText(depth + 1);
    const authoredOpening = firstLine(flat);
    if (prefix.length + authoredOpening.length + 1 > rustFormatWidth &&
      continuationIndent.length + authoredOpening.length <= rustFormatWidth) {
      const continuation = printRustExprFitted(
        initializer,
        depth + 1,
        continuationIndent.length,
        undefined,
        "expression",
        "initializer-continuation",
      );
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  if (!flat.includes("\n") &&
    (!renderedFits(flat, prefix.length + 1) ||
      prefix.length + flat.length + 1 > rustFormatWidth ||
      rustMethodChain(initializer) !== undefined &&
        prefix.length + flat.length + 1 > rustFormatWidth) &&
    renderedFits(flat, indentText(depth + 1).length + 1) &&
    initializer.kind !== "struct-literal" &&
    !rustMethodChainPrefersVerticalLayout(initializer)) {
    return `${prefix.trimEnd()}\n${indentText(depth + 1)}${flat};`;
  }
  return `${prefix}${printRustExprFitted(initializer, depth, prefix.length + 1)};`;
}

function rustfmtPrefersNextLine(original: string, nextLine: string): boolean {
  if (!nextLine.includes("\n")) {
    return true;
  }
  if (original.split("\n").length > nextLine.split("\n").length + 1) {
    return true;
  }
  const originalOpening = firstLine(original).trimEnd().slice(-1);
  const nextLineOpening = firstLine(nextLine).trimEnd().slice(-1);
  return (originalOpening === "(" || originalOpening === "{" || originalOpening === "[") &&
    nextLineOpening !== originalOpening;
}
