import { printRustExpr } from "./core.js";
import type { RustExpr } from "../../../backend/rust-ast/nodes.js";

export const enum RustPrecedence {
  Assignment = 0,
  Or = 1,
  And = 2,
  Comparison = 3,
  BitOr = 4,
  BitXor = 5,
  BitAnd = 6,
  Shift = 7,
  Additive = 8,
  Multiplicative = 9,
  Unary = 10,
  Cast = 11,
  Postfix = 12,
  Atom = 13,
}

export function operatorPrecedence(operator: string): RustPrecedence {
  switch (operator) {
    case "||":
      return RustPrecedence.Or;
    case "&&":
      return RustPrecedence.And;
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return RustPrecedence.Comparison;
    case "|":
      return RustPrecedence.BitOr;
    case "^":
      return RustPrecedence.BitXor;
    case "&":
      return RustPrecedence.BitAnd;
    case "<<":
    case ">>":
      return RustPrecedence.Shift;
    case "+":
    case "-":
      return RustPrecedence.Additive;
    default:
      return RustPrecedence.Multiplicative;
  }
}

export function expressionPrecedence(expression: RustExpr): RustPrecedence {
  switch (expression.kind) {
    case "bottom":
      return expressionPrecedence(expression.expression);
    case "assignment":
    case "return-expression":
    case "conditional":
    case "match":
    case "closure":
    case "closure-block":
      return RustPrecedence.Assignment;
    case "range":
      return RustPrecedence.Or;
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
    case "reference":
    case "dereference":
      return RustPrecedence.Unary;
    case "numeric-cast":
      return RustPrecedence.Cast;
    case "method-call":
    case "invoke":
    case "field":
    case "index":
    case "await":
      return RustPrecedence.Postfix;
    default:
      return RustPrecedence.Atom;
  }
}

export function printOperand(operand: RustExpr, parent: RustPrecedence, isRightSide: boolean): string {
  const text = printRustExpr(operand);
  return expressionNeedsParentheses(operand, parent, isRightSide)
    ? `(${text})`
    : text;
}

export function expressionNeedsParentheses(
  expression: RustExpr,
  parent: RustPrecedence,
  isRightSide: boolean,
): boolean {
  if (isRightSide && expression.kind !== "match" && expressionIsRightHandBlock(expression)) {
    return false;
  }
  const own = expressionPrecedence(expression);
  return own < parent ||
    (own === parent && (isRightSide || parent === RustPrecedence.Comparison));
}

export function expressionIsRightHandBlock(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsRightHandBlock(expression.expression);
  }
  return expression.kind === "conditional" ||
    expression.kind === "match" ||
    expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}

export function expressionIsStatementBlockOperand(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsStatementBlockOperand(expression.expression);
  }
  return expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}

export type RustExpressionGrammarPosition = "condition" | "expression" | "statement";

export function printBinaryOperand(
  operand: RustExpr,
  operator: string,
  isRightSide: boolean,
): string {
  const rendered = printOperand(operand, operatorPrecedence(operator), isRightSide);
  return operand.kind === "numeric-cast" &&
      (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")
    ? `(${rendered})`
    : rendered;
}

export function printFittedBinaryOperand(
  operand: RustExpr,
  rendered: string,
  operator: string,
  isRightSide: boolean,
  forceParentheses = false,
): string {
  const grouped = forceParentheses || expressionNeedsParentheses(
    operand,
    operatorPrecedence(operator),
    isRightSide,
  )
    ? `(${rendered})`
    : rendered;
  return operand.kind === "numeric-cast" &&
      (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")
    ? `(${grouped})`
    : grouped;
}
