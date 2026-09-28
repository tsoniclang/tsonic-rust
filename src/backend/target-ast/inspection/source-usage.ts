import type { RustBlock, RustExpr, RustStmt } from "../nodes.js";
import { rustParametersBindName, rustPatternBindsName } from "../patterns.js";
import { rustExpressionChildren } from "./expression-children.js";
import { rustExpressionContainsExpansion, rustStatementContainsExpansion, rustStatementsContainExpansion } from "./macro-expansion.js";

export function rustBlockReferencesPath(block: RustBlock, path: string): boolean {
  return rustStatementsReferencePath(block.statements, path);
}

export function rustStatementsReferencePath(
  statements: readonly RustStmt[],
  path: string,
): boolean {
  if (rustStatementsContainExpansion(statements)) return true;
  for (const statement of statements) {
    if (rustStatementReferencesPath(statement, path)) {
      return true;
    }
    if (statement.kind === "let" && rustPatternBindsName(statement.pattern, path) === true) {
      return false;
    }
  }
  return false;
}

export function rustStatementReferencesPath(statement: RustStmt, path: string): boolean {
  if (rustStatementContainsExpansion(statement)) return true;
  switch (statement.kind) {
    case "macro-statement":
      return true;
    case "item":
      return false;
    case "let":
      return rustPatternBindsName(statement.pattern, path) === undefined ||
        (statement.init !== undefined && rustExpressionReferencesPath(statement.init, path)) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path));
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
    case "while-let":
      return rustExpressionReferencesPath(statement.expression, path) ||
        patternBodyReferencesPath(statement, path);
    case "if-let":
      return rustExpressionReferencesPath(statement.expression, path) ||
        patternBodyReferencesPath(statement, path) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path));
    case "for":
      return rustExpressionReferencesPath(statement.iterable, path) ||
        patternBodyReferencesPath(statement, path);
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

function patternBodyReferencesPath(statement: Extract<RustStmt, { kind: "for" | "if-let" | "while-let" }>, path: string): boolean {
  const bound = rustPatternBindsName(statement.pattern, path);
  return bound === undefined || !bound && rustBlockReferencesPath(statement.body, path);
}

export function rustExpressionReferencesPath(expression: RustExpr, path: string): boolean {
  if (rustExpressionContainsExpansion(expression)) return true;
  if (expression.kind === "path") {
    return expression.path === path;
  }
  if (expression.kind === "closure") {
    const bound = rustParametersBindName(expression.params, path);
    return bound === undefined || !bound &&
      rustExpressionReferencesPath(expression.body, path);
  }
  if (expression.kind === "closure-block") {
    const bound = rustParametersBindName(expression.params, path);
    return bound === undefined || !bound &&
      rustBlockReferencesPath(expression.body, path);
  }
  if (expression.kind === "block") {
    for (const binding of expression.bindings) {
      if (binding.value !== undefined && rustExpressionReferencesPath(binding.value, path)) {
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
