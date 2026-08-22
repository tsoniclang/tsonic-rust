import { appendToLastLine, firstLine, renderedFits } from "../patterns.js";
import { indentText, printRustType } from "../types.js";
import { printRustAssociatedOwner, printRustSingleCollectionCallContinuation, rustMethodChain, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printRustClosureParams } from "./closure-params.js";
import { printRustExpr } from "./core.js";
import { printRustExprFitted } from "./fitted.js";
import { rustCompactTrailingClosureWidth, rustFormatWidth, rustMethodChainWidth, rustNestedCallWidth, rustSingleLineConditionalWidth } from "../formatting.js";
import { rustExpressionContainsExpandedStructLiteral, rustFormatArgumentCanShareLine, rustFormatArgumentIsAtomic, rustInvocationHasNestedExpandedCollection } from "./inspection.js";
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
  return [`${indent}${printRustExprFitted(
    expression,
    depth,
    indent.length,
    undefined,
    "statement",
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
  if (owner.kind !== "named" || owner.typeArguments === undefined || owner.typeArguments.length === 0) {
    return printRustType(owner);
  }
  const flat = printRustAssociatedOwner(owner);
  if (renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
    return flat;
  }
  const argumentIndent = indentText(depth + 1);
  const arguments_ = owner.typeArguments.map((argument) => {
    const rendered = printRustTypeFitted(argument, depth + 1, argumentIndent.length);
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
): string {
  const flat = printRustType(type);
  const longTuple = type.kind === "tuple" && flat.length > rustMethodChainWidth;
  if (!longTuple && renderedFits(flat, column) && column + flat.length + 1 < rustFormatWidth) {
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
  if (type.kind === "named" && type.typeArguments !== undefined && type.typeArguments.length > 0) {
    const argumentIndent = indentText(depth + 1);
    return [
      `${type.path}<`,
      ...type.typeArguments.map((argument) => {
        const rendered = printRustTypeFitted(argument, depth + 1, argumentIndent.length);
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
  const exactWidthInvocation = prefix.length + flat.length + 1 === rustFormatWidth &&
    rustLetInitializerUsesInvocationLayout(initializer);
  const complexStringConcat = initializer.kind === "string-concat" &&
    flat.length > rustNestedCallWidth &&
    !initializer.parts.every(rustFormatArgumentCanShareLine);
  if (!flat.includes("\n") && prefix.length + flat.length + 1 <= rustFormatWidth &&
    !exactWidthInvocation &&
    (initializer.kind !== "conditional" || flat.length <= rustSingleLineConditionalWidth) &&
    !rustExpressionContainsStatementBlock(initializer) &&
    !rustExpressionContainsExpandedStructLiteral(initializer) &&
    !rustMethodChainPrefersVerticalLayout(initializer) &&
    !complexStringConcat &&
    !(rustMethodChain(initializer) !== undefined &&
      prefix.length + flat.length + 1 >= rustFormatWidth)) {
    return `${prefix}${flat};`;
  }
  const fittedAtPrefix = printRustExprFitted(initializer, depth, prefix.length + 1);
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
  const directCallOpeningFits = (initializer.kind === "call" ||
      initializer.kind === "invoke" || initializer.kind === "associated-call") &&
    trailingClosure?.kind === "closure" &&
    fittedAtPrefix.includes("\n") &&
    !(initializer.kind === "associated-call" && flat.includes("\n") === false &&
      renderedFits(flat, indentText(depth + 1).length)) &&
    prefix.length + firstLine(fittedAtPrefix).length + 1 <= rustFormatWidth;
  if (directCallOpeningFits) {
    return appendToLastLine(`${prefix}${fittedAtPrefix}`, ";");
  }
  if (fittedAtPrefix.includes("\n")) {
    const continuationIndent = indentText(depth + 1);
    const continuation = printRustExprFitted(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
    const collectionCallContinuation = printRustSingleCollectionCallContinuation(
      initializer,
      depth + 1,
      continuationIndent.length,
    );
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
    const initializerHasNestedCollectionInvocation =
      rustInvocationHasNestedExpandedCollection(initializer);
    const compactContinuationLimit = methodChain === undefined
      ? rustFormatWidth
      : rustFormatWidth - 4;
    const continuationPacksMoreSource =
      !initializerHasNestedCollectionInvocation &&
        !continuation.includes("\n") && compactContinuationWidth <= compactContinuationLimit &&
        !bindingLineOwnsMultiSelectorChainBase ||
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
      );
      return `${prefix.trimEnd()}\n${continuationIndent}${continuation};`;
    }
  }
  if (!flat.includes("\n") &&
    (!renderedFits(flat, prefix.length + 1) ||
      prefix.length + flat.length + 1 >= rustFormatWidth ||
      rustMethodChain(initializer) !== undefined &&
        prefix.length + flat.length + 1 >= rustFormatWidth) &&
    renderedFits(flat, indentText(depth + 1).length + 1) &&
    initializer.kind !== "struct-literal" &&
    !rustMethodChainPrefersVerticalLayout(initializer)) {
    return `${prefix.trimEnd()}\n${indentText(depth + 1)}${flat};`;
  }
  return `${prefix}${printRustExprFitted(initializer, depth, prefix.length + 1)};`;
}

function rustLetInitializerUsesInvocationLayout(expression: RustExpr): boolean {
  if (expression.kind === "call" || expression.kind === "invoke" ||
    expression.kind === "associated-call" || expression.kind === "method-call") {
    return true;
  }
  return (expression.kind === "try" || expression.kind === "await") &&
    rustLetInitializerUsesInvocationLayout(expression.expr);
}
