import { printRustExpr } from "./core.js";
import { rustStructLiteralWidth } from "../formatting.js";
import type { RustExpr } from "../../../backend/rust-ast/nodes.js";

export function rustExpressionContainsExpandedStructLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "bottom":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "unary":
      return rustExpressionContainsExpandedStructLiteral(expression.operand);
    case "dereference":
      return rustExpressionContainsExpandedStructLiteral(expression.pointer);
    case "unsafe":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "numeric-cast":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "binary":
      return rustExpressionContainsExpandedStructLiteral(expression.left) ||
        rustExpressionContainsExpandedStructLiteral(expression.right);
    case "range":
      return rustExpressionContainsExpandedStructLiteral(expression.start) ||
        rustExpressionContainsExpandedStructLiteral(expression.end);
    case "conditional":
      return rustExpressionContainsExpandedStructLiteral(expression.condition) ||
        rustExpressionContainsExpandedStructLiteral(expression.whenTrue) ||
        rustExpressionContainsExpandedStructLiteral(expression.whenFalse);
    case "match":
      return rustExpressionContainsExpandedStructLiteral(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsExpandedStructLiteral(arm.expression));
    case "matches":
      return rustExpressionContainsExpandedStructLiteral(expression.expression);
    case "assignment":
      return rustExpressionContainsExpandedStructLiteral(expression.target) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "struct-literal": {
      const compactFields = expression.fields.map((field) => {
        const value = printRustExpr(field.value);
        return value === field.name ? field.name : `${field.name}: ${value}`;
      }).join(", ");
      return expression.fields.length > 2 || compactFields.length > rustStructLiteralWidth ||
        expression.fields.some((field) => rustExpressionContainsExpandedStructLiteral(field.value));
    }
    case "call":
    case "invoke":
    case "associated-call":
      return (expression.kind === "invoke" &&
          rustExpressionContainsExpandedStructLiteral(expression.callee)) ||
        expression.args.some(rustExpressionContainsExpandedStructLiteral);
    case "method-call":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver) ||
        expression.args.some(rustExpressionContainsExpandedStructLiteral);
    case "field":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver);
    case "index":
      return rustExpressionContainsExpandedStructLiteral(expression.receiver) ||
        rustExpressionContainsExpandedStructLiteral(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsExpandedStructLiteral(binding.value)) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "evaluate-then":
      return rustExpressionContainsExpandedStructLiteral(expression.effect) ||
        rustExpressionContainsExpandedStructLiteral(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsExpandedStructLiteral);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsExpandedStructLiteral);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsExpandedStructLiteral(expression.expr);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsExpandedStructLiteral(expression.expr);
    case "closure":
      return rustExpressionContainsExpandedStructLiteral(expression.body);
    default:
      return false;
  }
}
export function rustExpressionContainsExpandedCollectionLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "vec-literal":
    case "slice-literal":
      return expression.elements.length > 1 ||
        expression.elements.some(rustExpressionContainsExpandedCollectionLiteral);
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsExpandedCollectionLiteral);
    case "bottom":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "unary":
      return rustExpressionContainsExpandedCollectionLiteral(expression.operand);
    case "dereference":
      return rustExpressionContainsExpandedCollectionLiteral(expression.pointer);
    case "unsafe":
    case "numeric-cast":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "binary":
      return rustExpressionContainsExpandedCollectionLiteral(expression.left) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.right);
    case "range":
      return rustExpressionContainsExpandedCollectionLiteral(expression.start) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.end);
    case "conditional":
      return rustExpressionContainsExpandedCollectionLiteral(expression.condition) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.whenTrue) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.whenFalse);
    case "match":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsExpandedCollectionLiteral(arm.expression));
    case "matches":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expression);
    case "assignment":
      return rustExpressionContainsExpandedCollectionLiteral(expression.target) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "invoke":
      return rustExpressionContainsExpandedCollectionLiteral(expression.callee) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "method-call":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "field":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver);
    case "index":
      return rustExpressionContainsExpandedCollectionLiteral(expression.receiver) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsExpandedCollectionLiteral(binding.value)) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "evaluate-then":
      return rustExpressionContainsExpandedCollectionLiteral(expression.effect) ||
        rustExpressionContainsExpandedCollectionLiteral(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsExpandedCollectionLiteral);
    case "format-write":
      return rustExpressionContainsExpandedCollectionLiteral(expression.writer) ||
        expression.args.some(rustExpressionContainsExpandedCollectionLiteral);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsExpandedCollectionLiteral(expression.expr);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsExpandedCollectionLiteral(expression.expr);
    case "closure":
      return rustExpressionContainsExpandedCollectionLiteral(expression.body);
    case "struct-literal":
      return expression.fields.some((field) =>
        rustExpressionContainsExpandedCollectionLiteral(field.value));
    default:
      return false;
  }
}
export function rustInvocationHasNestedExpandedCollection(expression: RustExpr): boolean {
  const invocation = rustTransparentInvocationOperand(expression);
  const arguments_ = invocation.kind === "call" || invocation.kind === "associated-call" ||
      invocation.kind === "method-call"
    ? invocation.args
    : invocation.kind === "invoke"
      ? invocation.args
      : undefined;
  return arguments_?.some((argument) => {
    const nested = rustTransparentInvocationOperand(argument);
    return (nested.kind === "call" || nested.kind === "associated-call" ||
      nested.kind === "method-call" || nested.kind === "invoke") &&
      rustExpressionContainsExpandedCollectionLiteral(nested);
  }) === true;
}

function rustTransparentInvocationOperand(expression: RustExpr): RustExpr {
  if (expression.kind === "bottom") {
    return rustTransparentInvocationOperand(expression.expression);
  }
  if (expression.kind === "reference" || expression.kind === "await" || expression.kind === "try") {
    return rustTransparentInvocationOperand(expression.expr);
  }
  return expression;
}

export function rustFormatArgumentIsAtomic(expression: RustExpr): boolean {
  if (expression.kind === "unary") {
    return rustFormatArgumentIsAtomic(expression.operand);
  }
  return expression.kind === "int-literal" || expression.kind === "float-literal" ||
    expression.kind === "bool-literal" || expression.kind === "none" ||
    expression.kind === "str-literal" ||
    expression.kind === "path" || expression.kind === "associated-value";
}

export function rustFormatArgumentCanShareLine(expression: RustExpr): boolean {
  if (expression.kind === "string-literal" || rustFormatArgumentIsAtomic(expression)) {
    return true;
  }
  switch (expression.kind) {
    case "bottom":
    case "owned-string-from-borrowed-str":
      return rustFormatArgumentCanShareLine(expression.expression);
    case "call":
    case "associated-call":
      return expression.args.every(rustFormatArgumentCanShareLine);
    case "method-call":
      return rustFormatArgumentCanShareLine(expression.receiver) &&
        expression.args.every(rustFormatArgumentCanShareLine);
    case "field":
      return rustFormatArgumentCanShareLine(expression.receiver);
    case "index":
      return rustFormatArgumentCanShareLine(expression.receiver) &&
        rustFormatArgumentCanShareLine(expression.index);
    case "reference":
      return rustFormatArgumentCanShareLine(expression.expr);
    case "slice-literal":
    case "vec-literal":
    case "tuple-literal":
      return expression.elements.every(rustFormatArgumentCanShareLine);
    default:
      return false;
  }
}
