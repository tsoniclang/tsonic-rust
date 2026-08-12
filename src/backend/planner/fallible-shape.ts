import type { RustBlock, RustExpr, RustStmt } from "../rust-ast/nodes.js";

export function applyRustFallibleResultExpression(expression: RustExpr): RustExpr {
  return expression.kind === "try"
    ? expression.expr
    : { kind: "call", path: "Ok", args: [expression] };
}

export function applyFallibleShape(
  body: RustBlock,
  fallible: boolean,
  hasReturnValue: boolean,
): RustBlock {
  if (!fallible) {
    return body;
  }
  const wrap = (statement: RustStmt): RustStmt => {
    if (statement.kind === "return" && statement.expr !== undefined) {
      return { kind: "return", expr: applyRustFallibleResultExpression(statement.expr) };
    }
    if (statement.kind === "return") {
      return { kind: "return", expr: { kind: "path", path: "Ok(())" } };
    }
    if (statement.kind === "tail") {
      return { kind: "tail", expr: applyRustFallibleResultExpression(statement.expr) };
    }
    if (statement.kind === "if") {
      return {
        ...statement,
        then: { statements: statement.then.statements.map(wrap) },
        ...(statement.else === undefined ? {} : { else: { statements: statement.else.statements.map(wrap) } }),
      };
    }
    if (statement.kind === "while" || statement.kind === "for" ||
      statement.kind === "while-let-some" || statement.kind === "if-let-some") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "scope" || statement.kind === "unsafe-scope") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "try-scope") {
      return statement;
    }
    return statement;
  };
  const wrapped = body.statements.map(wrap);
  const last = wrapped[wrapped.length - 1];
  const endsWithExit = last !== undefined && (
    last.kind === "tail" ||
    last.kind === "return" ||
    last.kind === "throw" ||
    (last.kind === "resource-scope" && last.terminates) ||
    (last.kind === "try-scope" && last.terminates)
  );
  if (!hasReturnValue && !endsWithExit) {
    wrapped.push({ kind: "tail", expr: { kind: "path", path: "Ok(())" } });
  }
  return { ...body, statements: wrapped };
}
