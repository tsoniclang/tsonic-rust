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
  const flattened = parts.flatMap((part) =>
    part.kind === "string-concat" ? part.parts : [part]);
  const nonEmpty = flattened.filter((part) =>
    !((part.kind === "string-literal" || part.kind === "str-literal") &&
      part.value.length === 0));
  if (nonEmpty.length === 0) {
    return { kind: "string-literal", value: "" };
  }
  if (nonEmpty.length === 1) {
    const only = nonEmpty[0]!;
    return only.kind === "str-literal"
      ? { kind: "string-literal", value: only.value }
      : only;
  }
  const normalized: RustExpr[] = [];
  for (const part of nonEmpty) {
    const selected = rustBorrowedStringView(part);
    if ((selected.kind === "string-literal" || selected.kind === "str-literal") &&
      selected.value.length === 0) {
      continue;
    }
    const previous = normalized[normalized.length - 1];
    if ((previous?.kind === "string-literal" || previous?.kind === "str-literal") &&
      (selected.kind === "string-literal" || selected.kind === "str-literal")) {
      normalized[normalized.length - 1] = {
        kind: "string-literal",
        value: previous.value + selected.value,
      };
      continue;
    }
    normalized.push(selected);
  }
  if (normalized.length === 1) {
    const only = normalized[0]!;
    return only.kind === "str-literal"
      ? { kind: "string-literal", value: only.value }
      : only;
  }
  return {
    kind: "string-concat",
    parts: normalized,
  };
}

export function rustBorrowedStringView(expression: RustExpr): RustExpr {
  return expression.kind === "owned-string-from-borrowed-str"
    ? expression.expression
    : expression;
}

export function tupleRustClosureArguments(
  expression: RustExpr,
  argumentName: string,
  arity: number,
): RustExpr | undefined {
  if (expression.kind === "block") {
    const value = tupleRustClosureArguments(expression.value, argumentName, arity);
    return value === undefined ? undefined : { ...expression, value };
  }
  if (expression.kind !== "closure" && expression.kind !== "closure-block") {
    return undefined;
  }
  if (expression.params.length !== arity) {
    return undefined;
  }
  const bindings = expression.params.map((parameter, index) => ({
    kind: "let" as const,
    name: parameter.name,
    mutable: "mutable" in parameter && parameter.mutable,
    init: parameter.byRefCopy === true
      ? {
          kind: "dereference" as const,
          pointer: {
            kind: "field" as const,
            receiver: { kind: "path" as const, path: argumentName },
            name: String(index),
          },
        }
      : {
          kind: "field" as const,
          receiver: { kind: "path" as const, path: argumentName },
          name: String(index),
        },
  }));
  const body = expression.kind === "closure"
    ? { statements: [...bindings, { kind: "tail" as const, expr: expression.body }] }
    : { ...expression.body, statements: [...bindings, ...expression.body.statements] };
  return {
    kind: "closure-block",
    params: [{ name: argumentName, mutable: false }],
    move: expression.move === true,
    async: expression.kind === "closure-block" && expression.async,
    body,
  };
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
    case "char-literal":
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
