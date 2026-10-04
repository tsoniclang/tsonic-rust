import type { RustBlock, RustExpr, RustPattern, RustStmt } from "../nodes.js";

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
    case "item":
      return false;
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

export function rustBlockBreaksToLabel(block: RustBlock, label: string): boolean {
  const expression = (value: RustExpr): boolean => {
    if (value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block") return false;
    return value.kind === "break-expression" && value.label === label ||
      rustExpressionChildren(value).some(expression);
  };
  return block.statements.some(statement => statement.kind === "break" && statement.label === label ||
    rustStatementExpressions(statement).some(expression));
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
  if (expression.kind === "async-block") return rustBlockReferencesPath(expression.body, path);
  if (expression.kind === "if-let") return rustExpressionReferencesPath(expression.expression, path) ||
    !rustPatternBindsPath(expression.pattern, path) && rustExpressionReferencesPath(expression.whenTrue, path) ||
    expression.whenFalse !== undefined && rustExpressionReferencesPath(expression.whenFalse, path);
  if (expression.kind === "block") return rustBlockReferencesPath(expression.body, path);
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
    case "async-block":
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
    case "if-let":
      return [expression.expression, expression.whenTrue, ...(expression.whenFalse === undefined ? [] : [expression.whenFalse])];
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
    case "option-presence":
    case "field":
      return [expression.receiver];
    case "index":
      return [expression.receiver, expression.index];
    case "block":
      return expression.body.statements.flatMap(rustStatementExpressions);
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
    case "array-repeat":
      return expression.length.kind === "path"
        ? [expression.element, { kind: "path", path: expression.length.path }]
        : [expression.element];
    case "closure":
      return [expression.body];
    case "await":
    case "option-try":
    case "try":
      return [expression.expr];
    case "break-expression":
    case "return-expression":
      return expression.expr === undefined ? [] : [expression.expr];
    case "struct-literal":
      return [
        ...expression.fields.map((field) => field.value),
        ...(expression.base === undefined ? [] : [expression.base]),
      ];
  }
}

export function rustPatternBindsPath(pattern: RustPattern, path: string): boolean {
  switch (pattern.kind) {
    case "struct": return pattern.fields.some(field => rustPatternBindsPath(field.pattern, path));
    case "binding": return pattern.name === path;
    case "tuple":
    case "tuple-variant": return pattern.elements.some(element => rustPatternBindsPath(element, path));
    case "or": return pattern.alternatives.some(alternative => rustPatternBindsPath(alternative, path));
    case "path":
    case "wildcard": return false;
  }
}

export function rustStatementExpressions(statement: RustStmt): readonly RustExpr[] {
  const block = (body: RustBlock): readonly RustExpr[] => body.statements.flatMap(rustStatementExpressions);
  switch (statement.kind) {
    case "item":
    case "break":
    case "continue": return [];
    case "let": return statement.init === undefined ? [] : [statement.init];
    case "expr":
    case "tail": return [statement.expr];
    case "return": return [{ kind: "return-expression", ...(statement.expr === undefined ? {} : { expr: statement.expr }) }];
    case "assign": return [statement.target, statement.value];
    case "if": return [statement.condition, ...block(statement.then), ...(statement.else === undefined ? [] : block(statement.else))];
    case "loop":
    case "scope":
    case "unsafe-scope": return block(statement.body);
    case "while": return [statement.condition, ...block(statement.body)];
    case "while-let-some": return [statement.expression, ...block(statement.body)];
    case "for": return [statement.iterable, ...block(statement.body)];
    case "completion-exit": return statement.expr === undefined ? [] : [statement.expr];
    case "resource-scope": return [...block(statement.body), ...block(statement.cleanup),
      ...statement.dispatchTargets.flatMap(target => target.continuePrelude?.flatMap(rustStatementExpressions) ?? [])];
    case "try-scope": return [...block(statement.body),
      ...(statement.catchClause === undefined ? [] : block(statement.catchClause.body)),
      ...(statement.finallyClause === undefined ? [] : block(statement.finallyClause.body)),
      ...statement.dispatchTargets.flatMap(target => target.continuePrelude?.flatMap(rustStatementExpressions) ?? [])];
    case "index-assign": return [statement.receiver, statement.index, statement.value];
    case "throw": return [statement.error];
  }
}
