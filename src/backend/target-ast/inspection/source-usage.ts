import type { RustBlock, RustExpr, RustStmt } from "../nodes.js";

export function rustBlockReferencesPath(block: RustBlock, path: string): boolean {
  return rustStatementsReferencePath(block.statements, path);
}

export function rustStatementsReferencePath(
  statements: readonly RustStmt[],
  path: string,
): boolean {
  for (const statement of statements) {
    if (rustStatementReferencesPath(statement, path)) {
      return true;
    }
    if (statement.kind === "let" && statement.name === path) {
      return false;
    }
  }
  return false;
}

export function rustStatementReferencesPath(statement: RustStmt, path: string): boolean {
  switch (statement.kind) {
    case "let":
      return statement.init !== undefined && rustExpressionReferencesPath(statement.init, path);
    case "expr":
    case "tail":
      return rustExpressionReferencesPath(statement.expr, path);
    case "assign":
      return rustExpressionReferencesPath(statement.target, path) ||
        rustExpressionReferencesPath(statement.value, path);
    case "return":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path);
    case "if":
      return rustExpressionReferencesPath(statement.condition, path) ||
        rustBlockReferencesPath(statement.then, path) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path));
    case "loop":
      return rustBlockReferencesPath(statement.body, path);
    case "while":
      return rustExpressionReferencesPath(statement.condition, path) ||
        rustBlockReferencesPath(statement.body, path);
    case "while-let-some":
      return rustExpressionReferencesPath(statement.expression, path) ||
        (statement.binding !== path && rustBlockReferencesPath(statement.body, path));
    case "if-let-some":
      return rustExpressionReferencesPath(statement.expression, path) ||
        (statement.binding !== path && rustBlockReferencesPath(statement.body, path)) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path));
    case "for":
      return rustExpressionReferencesPath(statement.iterable, path) ||
        (statement.binding !== path && rustBlockReferencesPath(statement.body, path));
    case "break":
    case "continue":
      return false;
    case "completion-exit":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path);
    case "resource-scope":
      return rustBlockReferencesPath(statement.body, path) ||
        rustBlockReferencesPath(statement.cleanup, path) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesPath(value, path)) === true);
    case "index-assign":
      return rustExpressionReferencesPath(statement.receiver, path) ||
        rustExpressionReferencesPath(statement.index, path) ||
        rustExpressionReferencesPath(statement.value, path);
    case "scope":
    case "unsafe-scope":
      return rustBlockReferencesPath(statement.body, path);
    case "throw":
      return rustExpressionReferencesPath(statement.error, path);
    case "try-scope":
      return rustBlockReferencesPath(statement.body, path) ||
        (statement.catchClause !== undefined &&
          statement.catchClause.binding !== path &&
          rustBlockReferencesPath(statement.catchClause.body, path)) ||
        (statement.finallyClause !== undefined &&
          rustBlockReferencesPath(statement.finallyClause.body, path)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesPath(value, path)) === true);
  }
}

export function rustExpressionReferencesPath(expression: RustExpr, path: string): boolean {
  if (expression.kind === "path") {
    return expression.path === path;
  }
  if (expression.kind === "closure") {
    return !expression.params.some((parameter) => parameter.name === path) &&
      rustExpressionReferencesPath(expression.body, path);
  }
  if (expression.kind === "closure-block") {
    return !expression.params.some((parameter) => parameter.name === path) &&
      rustBlockReferencesPath(expression.body, path);
  }
  if (expression.kind === "block") {
    for (const binding of expression.bindings) {
      if (rustExpressionReferencesPath(binding.value, path)) {
        return true;
      }
      if (binding.name === path) {
        return false;
      }
    }
    return rustExpressionReferencesPath(expression.value, path);
  }
  return rustExpressionChildren(expression).some((child) =>
    rustExpressionReferencesPath(child, path));
}

export function rustExpressionChildren(expression: RustExpr): readonly RustExpr[] {
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
    case "closure-block":
      return [];
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return [expression.expression];
    case "unary":
      return [expression.operand];
    case "dereference":
      return [expression.pointer];
    case "binary":
      return [expression.left, expression.right];
    case "range":
      return [expression.start, expression.end];
    case "conditional":
      return [expression.condition, expression.whenTrue, expression.whenFalse];
    case "match":
      return [expression.expression, ...expression.arms.map((arm) => arm.expression)];
    case "matches":
      return [expression.expression];
    case "assignment":
      return [expression.target, expression.value];
    case "call":
    case "associated-call":
      return expression.args;
    case "invoke":
      return [expression.callee, ...expression.args];
    case "method-call":
      return [expression.receiver, ...expression.args];
    case "macro-invocation":
      return expression.args;
    case "field":
      return [expression.receiver];
    case "index":
      return [expression.receiver, expression.index];
    case "block":
      return [...expression.bindings.map((binding) => binding.value), expression.value];
    case "evaluate-then":
      return [expression.effect, expression.value];
    case "string-concat":
      return expression.parts;
    case "format-write":
      return [expression.writer, ...expression.args];
    case "reference":
      return [expression.expr];
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements;
    case "closure":
      return [expression.body];
    case "await":
    case "try":
      return [expression.expr];
    case "return-expression":
      return expression.expr === undefined ? [] : [expression.expr];
    case "struct-literal":
      return [
        ...expression.fields.map((field) => field.value),
        ...(expression.base === undefined ? [] : [expression.base]),
      ];
  }
}
