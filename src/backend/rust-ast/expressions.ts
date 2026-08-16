import type { RustExpr } from "./nodes.js";

export function negateRustBooleanExpression(expression: RustExpr): RustExpr {
  if (expression.kind === "bool-literal") {
    return { kind: "bool-literal", value: !expression.value };
  }
  if (expression.kind === "unary" && expression.operator === "!") {
    return expression.operand;
  }
  if (expression.kind === "method-call" && expression.args.length === 0 &&
    (expression.method === "is_some" || expression.method === "is_none")) {
    return {
      ...expression,
      method: expression.method === "is_some" ? "is_none" : "is_some",
    };
  }
  if (expression.kind === "binary") {
    const inverse = expression.operator === "==" ? "!="
      : expression.operator === "!=" ? "=="
        : undefined;
    if (inverse !== undefined) {
      return { ...expression, operator: inverse };
    }
    if (expression.operator === "&&" || expression.operator === "||") {
      return {
        kind: "binary",
        operator: expression.operator === "&&" ? "||" : "&&",
        left: negateRustBooleanExpression(expression.left),
        right: negateRustBooleanExpression(expression.right),
      };
    }
  }
  return { kind: "unary", operator: "!", operand: expression };
}

export function rustStringConcat(parts: readonly RustExpr[]): RustExpr {
  return {
    kind: "string-concat",
    parts: parts.flatMap((part) => part.kind === "string-concat" ? part.parts : [part])
      .map(rustBorrowedStringView),
  };
}

export function rustBorrowedStringView(expression: RustExpr): RustExpr {
  return expression.kind === "owned-string-from-borrowed-str"
    ? expression.expression
    : expression;
}

export function rustExpressionContainsStatementBlock(expression: RustExpr): boolean {
  if (expression.kind === "block" || expression.kind === "closure-block" ||
    expression.kind === "evaluate-then" || expression.kind === "match") {
    return true;
  }
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "string-literal":
    case "str-literal":
    case "path":
    case "associated-value":
    case "unreachable":
      return false;
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsStatementBlock(expression.expression);
    case "unary":
      return rustExpressionContainsStatementBlock(expression.operand);
    case "dereference":
      return rustExpressionContainsStatementBlock(expression.pointer);
    case "binary":
      return rustExpressionContainsStatementBlock(expression.left) ||
        rustExpressionContainsStatementBlock(expression.right);
    case "range":
      return rustExpressionContainsStatementBlock(expression.start) ||
        rustExpressionContainsStatementBlock(expression.end);
    case "conditional":
      return rustExpressionContainsStatementBlock(expression.condition) ||
        rustExpressionContainsStatementBlock(expression.whenTrue) ||
        rustExpressionContainsStatementBlock(expression.whenFalse);
    case "matches":
      return rustExpressionContainsStatementBlock(expression.expression);
    case "assignment":
      return rustExpressionContainsStatementBlock(expression.target) ||
        rustExpressionContainsStatementBlock(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionContainsStatementBlock);
    case "invoke":
      return rustExpressionContainsStatementBlock(expression.callee) ||
        expression.args.some(rustExpressionContainsStatementBlock);
    case "method-call":
      return rustExpressionContainsStatementBlock(expression.receiver) ||
        expression.args.some(rustExpressionContainsStatementBlock);
    case "field":
      return rustExpressionContainsStatementBlock(expression.receiver);
    case "index":
      return rustExpressionContainsStatementBlock(expression.receiver) ||
        rustExpressionContainsStatementBlock(expression.index);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsStatementBlock);
    case "format-write":
      return rustExpressionContainsStatementBlock(expression.writer) ||
        expression.args.some(rustExpressionContainsStatementBlock);
    case "reference":
      return rustExpressionContainsStatementBlock(expression.expr);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsStatementBlock);
    case "closure":
      return rustExpressionContainsStatementBlock(expression.body);
    case "await":
    case "try":
      return rustExpressionContainsStatementBlock(expression.expr);
    case "return-expression":
      return expression.expr !== undefined && rustExpressionContainsStatementBlock(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionContainsStatementBlock(field.value));
  }
}
