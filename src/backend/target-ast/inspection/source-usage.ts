import type { RustBlock, RustExpr, RustStmt } from "../nodes.js";
import { rustParametersBindName, rustPatternBindsName } from "../patterns.js";
import { rustExpressionChildren } from "./expression-children.js";

export function rustBlockReferencesPath(block: RustBlock, path: string, visible = true): boolean {
  return rustStatementsReferencePath(block.statements, path, visible);
}

export function rustStatementsReferencePath(
  statements: readonly RustStmt[],
  path: string,
  visible = true,
): boolean {
  for (const statement of statements) {
    if (rustStatementReferencesPath(statement, path, visible)) {
      return true;
    }
    if (statement.kind === "let" && rustPatternBindsName(statement.pattern, path) === true) {
      visible = false;
    }
  }
  return false;
}

export function rustStatementReferencesPath(statement: RustStmt, path: string, visible = true): boolean {
  switch (statement.kind) {
    case "macro-statement":
      return true;
    case "item":
      return statement.item.kind === "macro-invocation";
    case "let":
      return rustPatternBindsName(statement.pattern, path) === undefined ||
        (statement.init !== undefined && rustExpressionReferencesPath(statement.init, path, visible)) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path, visible));
    case "expr":
    case "tail":
      return rustExpressionReferencesPath(statement.expr, path, visible);
    case "assign":
      return rustExpressionReferencesPath(statement.target, path, visible) ||
        rustExpressionReferencesPath(statement.value, path, visible);
    case "return":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path, visible);
    case "if":
      return rustExpressionReferencesPath(statement.condition, path, visible) ||
        rustBlockReferencesPath(statement.then, path, visible) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path, visible));
    case "loop":
      return rustBlockReferencesPath(statement.body, path, visible);
    case "while":
      return rustExpressionReferencesPath(statement.condition, path, visible) ||
        rustBlockReferencesPath(statement.body, path, visible);
    case "while-let":
      return rustExpressionReferencesPath(statement.expression, path, visible) ||
        patternBodyReferencesPath(statement, path, visible);
    case "if-let":
      return rustExpressionReferencesPath(statement.expression, path, visible) ||
        patternBodyReferencesPath(statement, path, visible) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path, visible));
    case "for":
      return rustExpressionReferencesPath(statement.iterable, path, visible) ||
        patternBodyReferencesPath(statement, path, visible);
    case "break":
    case "continue":
      return false;
    case "completion-exit":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path, visible);
    case "resource-scope":
      return rustBlockReferencesPath(statement.body, path, visible) ||
        rustBlockReferencesPath(statement.cleanup, path, visible) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesPath(value, path, visible)) === true);
    case "index-assign":
      return rustExpressionReferencesPath(statement.receiver, path, visible) ||
        rustExpressionReferencesPath(statement.index, path, visible) ||
        rustExpressionReferencesPath(statement.value, path, visible);
    case "scope":
    case "unsafe-scope":
      return rustBlockReferencesPath(statement.body, path, visible);
    case "throw":
      return rustExpressionReferencesPath(statement.error, path, visible);
    case "try-scope":
      return rustBlockReferencesPath(statement.body, path, visible) ||
        (statement.catchClause !== undefined &&
          rustBlockReferencesPath(statement.catchClause.body, path, visible && statement.catchClause.binding !== path)) ||
        (statement.finallyClause !== undefined &&
          rustBlockReferencesPath(statement.finallyClause.body, path, visible)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesPath(value, path, visible)) === true);
  }
}

function patternBodyReferencesPath(statement: Extract<RustStmt, { kind: "for" | "if-let" | "while-let" }>, path: string, visible: boolean): boolean {
  const bound = rustPatternBindsName(statement.pattern, path);
  return bound === undefined || rustBlockReferencesPath(statement.body, path, visible && !bound);
}

export function rustExpressionReferencesPath(expression: RustExpr, path: string, visible = true): boolean {
  if (expression.kind === "macro-invocation") return true;
  if (expression.kind === "path") {
    return visible && expression.path === path;
  }
  if (expression.kind === "closure") {
    const bound = rustParametersBindName(expression.params, path);
    return bound === undefined || rustExpressionReferencesPath(expression.body, path, visible && !bound);
  }
  if (expression.kind === "closure-block") {
    const bound = rustParametersBindName(expression.params, path);
    return bound === undefined || rustBlockReferencesPath(expression.body, path, visible && !bound);
  }
  if (expression.kind === "match") {
    return rustExpressionReferencesPath(expression.expression, path, visible) || expression.arms.some(arm => {
      const bound = rustPatternBindsName(arm.pattern, path);
      return bound === undefined || rustExpressionReferencesPath(arm.expression, path, visible && !bound);
    });
  }
  if (expression.kind === "matches") {
    return rustPatternBindsName(expression.pattern, path) === undefined ||
      rustExpressionReferencesPath(expression.expression, path, visible);
  }
  if (expression.kind === "block") {
    for (const binding of expression.bindings) {
      if (binding.value !== undefined && rustExpressionReferencesPath(binding.value, path, visible)) {
        return true;
      }
      if (binding.name === path) {
        visible = false;
      }
    }
    return rustExpressionReferencesPath(expression.value, path, visible);
  }
  return rustExpressionChildren(expression).some((child) =>
    rustExpressionReferencesPath(child, path, visible));
}
