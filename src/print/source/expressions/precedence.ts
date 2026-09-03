import type { RustExpr } from "../../../backend/target-ast/nodes.js";

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
    case "try":
      return RustPrecedence.Postfix;
    default:
      return RustPrecedence.Atom;
  }
}

export function expressionNeedsParentheses(
  expression: RustExpr,
  parent: RustPrecedence,
  isRightSide: boolean,
): boolean {
  if (isRightSide && expression.kind !== "match" && expressionIsRightHandBlock(expression)) {
    return false;
  }
  if (expressionIsStatementBlock(expression)) {
    return !isRightSide &&
      (parent <= RustPrecedence.Multiplicative || parent === RustPrecedence.Cast);
  }
  const own = expressionPrecedence(expression);
  return own < parent ||
    (own === parent && (isRightSide || parent === RustPrecedence.Comparison));
}

function expressionIsStatementBlock(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsStatementBlock(expression.expression);
  }
  return expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}

function expressionIsRightHandBlock(expression: RustExpr): boolean {
  if (expression.kind === "bottom") {
    return expressionIsRightHandBlock(expression.expression);
  }
  return expression.kind === "conditional" ||
    expression.kind === "match" ||
    expression.kind === "block" ||
    expression.kind === "unsafe" ||
    expression.kind === "evaluate-then";
}
