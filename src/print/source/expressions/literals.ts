import { appendToLastLine, firstLine, renderedFits, rustExpressionContainsTry } from "../patterns.js";
import { indentText } from "../types.js";
import { rustFormatWidth, rustNestedCallWidth, rustStructLiteralWidth } from "../formatting.js";
import { printRustExpr } from "./core.js";
import {
  rustExpressionContainsExpandedStructLiteral,
  rustFormatArgumentIsAtomic,
} from "./inspection.js";
import { rustExpressionContainsStatementBlock } from "../../../backend/target-ast/expressions.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

type RustCollectionLiteral = Extract<
  RustExpr,
  { readonly kind: "vec-literal" | "slice-literal" | "tuple-literal" }
>;

type RustStructLiteral = Extract<RustExpr, { readonly kind: "struct-literal" }>;

type RenderFittedExpression = (
  expression: RustExpr,
  depth: number,
  column: number,
) => string;

export function printRustCollectionLiteralFitted(
  expression: RustCollectionLiteral,
  depth: number,
  column: number,
  renderExpression: RenderFittedExpression,
): string {
  const flat = printRustExpr(expression);
  if (!flat.includes("\n") &&
    !rustExpressionContainsExpandedStructLiteral(expression) &&
    !(expression.kind === "tuple-literal" &&
      rustExpressionContainsTry(expression) &&
      flat.length > rustNestedCallWidth) &&
    renderedFits(flat, column)) {
    return flat;
  }
  const onlyElement = expression.elements[0];
  if (expression.kind === "tuple-literal" && expression.elements.length === 1 &&
    onlyElement !== undefined) {
    const attachedElement = renderExpression(onlyElement, depth, column + 1);
    const elementIndent = indentText(depth + 1);
    const expandedElement = attachedElement.includes("\n")
      ? renderExpression(onlyElement, depth + 1, elementIndent.length)
      : undefined;
    if (expandedElement !== undefined && !expandedElement.includes("\n") &&
      renderedFits(`${expandedElement},`, elementIndent.length)) {
      return [
        "(",
        `${elementIndent}${expandedElement},`,
        `${indentText(depth)})`,
      ].join("\n");
    }
    return appendToLastLine(`(${attachedElement}`, ",)");
  }
  if (expression.kind !== "tuple-literal" && expression.elements.length === 1 &&
    onlyElement !== undefined) {
    const opening = expression.kind === "vec-literal" ? "vec![" : "[";
    const closingWidth = onlyElement.kind === "method-call" ? 0 : 1;
    const rendered = renderExpression(
      onlyElement,
      depth,
      column + opening.length + closingWidth,
    );
    const attached = appendToLastLine(`${opening}${rendered}`, "]");
    const overflowableElement = rustCollectionElementOwnsOverflow(onlyElement) &&
      !(expression.kind === "vec-literal" && onlyElement.kind === "method-call");
    if (rendered.includes("\n") &&
      (onlyElement.kind === "block" || onlyElement.kind === "evaluate-then" ||
        !rustExpressionContainsStatementBlock(onlyElement) ||
        overflowableElement ||
        rustExpressionIsSingleCollectionInvocation(onlyElement) ||
        rendered.split("\n").length <= 4) &&
      column + firstLine(attached).length + 1 <= rustFormatWidth &&
      renderedFits(attached, column)) {
      return attached;
    }
  }
  const elementIndent = indentText(depth + 1);
  const compactElements = expression.elements.map(printRustExpr).join(", ");
  const elements = expression.kind !== "tuple-literal" &&
      !rustExpressionContainsExpandedStructLiteral(expression) &&
      expression.elements.every(rustFormatArgumentIsAtomic) &&
      compactElements.length <= rustNestedCallWidth &&
      renderedFits(`${compactElements},`, elementIndent.length)
    ? [`${elementIndent}${compactElements},`]
    : expression.elements.map((element) => appendToLastLine(
        `${elementIndent}${renderExpression(element, depth + 1, elementIndent.length)}`,
        ",",
      ));
  return [
    expression.kind === "vec-literal" ? "vec![" : expression.kind === "slice-literal" ? "[" : "(",
    ...elements,
    `${indentText(depth)}${expression.kind === "tuple-literal" ? ")" : "]"}`,
  ].join("\n");
}

function rustCollectionElementOwnsOverflow(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "call":
    case "associated-call":
    case "method-call":
    case "invoke":
    case "macro-invocation":
    case "string-concat":
    case "format-write":
      return true;
    case "bottom":
      return rustCollectionElementOwnsOverflow(expression.expression);
    case "reference":
      return rustCollectionElementOwnsOverflow(expression.expr);
    case "try":
      return rustCollectionElementOwnsOverflow(expression.expr);
    case "unary":
      return rustCollectionElementOwnsOverflow(expression.operand);
    case "dereference":
      return rustCollectionElementOwnsOverflow(expression.pointer);
    case "numeric-cast":
    case "owned-string-from-borrowed-str":
      return rustCollectionElementOwnsOverflow(expression.expression);
    default:
      return false;
  }
}

function rustExpressionIsSingleCollectionInvocation(expression: RustExpr): boolean {
  if (expression.kind !== "call" && expression.kind !== "associated-call" &&
    expression.kind !== "method-call" && expression.kind !== "invoke") {
    return false;
  }
  const argument = expression.args.length === 1 ? expression.args[0] : undefined;
  const selected = argument?.kind === "reference" ? argument.expr : argument;
  return selected?.kind === "slice-literal" || selected?.kind === "vec-literal";
}

export function printRustStructLiteralFitted(
  expression: RustStructLiteral,
  depth: number,
  column: number,
  renderExpression: RenderFittedExpression,
): string {
  const flat = printRustExpr(expression);
  const compactFields = expression.fields
    .map((field) => {
      const value = printRustExpr(field.value);
      return value === field.name ? field.name : `${field.name}: ${value}`;
    })
    .join(", ");
  if (expression.fields.length <= 2 && compactFields.length <= rustStructLiteralWidth &&
    !flat.includes("\n") && renderedFits(flat, column)) {
    return flat;
  }
  const fieldIndent = indentText(depth + 1);
  const fields = expression.fields.map((field) => {
    const flatValue = printRustExpr(field.value);
    if (flatValue === field.name) {
      return `${fieldIndent}${field.name},`;
    }
    const prefix = `${fieldIndent}${field.name}: `;
    return appendToLastLine(
      `${prefix}${renderExpression(field.value, depth + 1, prefix.length + 1)}`,
      ",",
    );
  });
  if (expression.base !== undefined) {
    const prefix = `${fieldIndent}..`;
    fields.push(`${prefix}${renderExpression(expression.base, depth + 1, prefix.length)}`);
  }
  return [
    `${expression.path} {`,
    ...fields,
    `${indentText(depth)}}`,
  ].join("\n");
}
