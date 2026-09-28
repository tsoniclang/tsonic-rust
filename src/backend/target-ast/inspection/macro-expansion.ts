import type { RustBlock, RustExpr, RustStmt } from "../nodes.js";
import { rustPatternBindings } from "../patterns.js";
import { rustExpressionChildren } from "./expression-children.js";

export function rustExpressionContainsExpansion(expression: RustExpr): boolean {
  if (expression.kind === "macro-invocation") return true;
  if (expression.kind === "closure" || expression.kind === "closure-block") {
    if (expression.params.some(parameter => rustPatternBindings(parameter.pattern) === undefined)) return true;
    return expression.kind === "closure"
      ? rustExpressionContainsExpansion(expression.body)
      : rustBlockContainsExpansion(expression.body);
  }
  if (expression.kind === "match" &&
    expression.arms.some(arm => rustPatternBindings(arm.pattern) === undefined)) return true;
  if (expression.kind === "matches" && rustPatternBindings(expression.pattern) === undefined) return true;
  return rustExpressionChildren(expression).some(rustExpressionContainsExpansion);
}

export function rustStatementsContainExpansion(statements: readonly RustStmt[]): boolean {
  return statements.some(rustStatementContainsExpansion);
}

function rustBlockContainsExpansion(block: RustBlock | undefined): boolean {
  return block !== undefined && rustStatementsContainExpansion(block.statements);
}

export function rustStatementContainsExpansion(statement: RustStmt): boolean {
  switch (statement.kind) {
    case "macro-statement":
      return true;
    case "item":
      return statement.item.kind === "macro-invocation";
    case "let":
      return rustPatternBindings(statement.pattern) === undefined ||
        statement.init !== undefined && rustExpressionContainsExpansion(statement.init) ||
        rustBlockContainsExpansion(statement.else);
    case "expr":
    case "tail":
      return rustExpressionContainsExpansion(statement.expr);
    case "assign":
      return rustExpressionContainsExpansion(statement.target) || rustExpressionContainsExpansion(statement.value);
    case "return":
    case "completion-exit":
      return statement.expr !== undefined && rustExpressionContainsExpansion(statement.expr);
    case "if":
      return rustExpressionContainsExpansion(statement.condition) ||
        rustBlockContainsExpansion(statement.then) || rustBlockContainsExpansion(statement.else);
    case "loop":
    case "scope":
    case "unsafe-scope":
      return rustBlockContainsExpansion(statement.body);
    case "while":
      return rustExpressionContainsExpansion(statement.condition) || rustBlockContainsExpansion(statement.body);
    case "while-let":
    case "if-let":
    case "for":
      return rustPatternBindings(statement.pattern) === undefined ||
        rustExpressionContainsExpansion(statement.kind === "for" ? statement.iterable : statement.expression) ||
        rustBlockContainsExpansion(statement.body) ||
        statement.kind === "if-let" && rustBlockContainsExpansion(statement.else);
    case "break":
    case "continue":
      return false;
    case "resource-scope":
    case "try-scope":
      return rustBlockContainsExpansion(statement.body) ||
        (statement.kind === "resource-scope" ? rustBlockContainsExpansion(statement.cleanup)
          : rustBlockContainsExpansion(statement.catchClause?.body) || rustBlockContainsExpansion(statement.finallyClause?.body)) ||
        statement.dispatchTargets.some(target => target.continuePrelude !== undefined &&
          rustStatementsContainExpansion(target.continuePrelude));
    case "index-assign":
      return rustExpressionContainsExpansion(statement.receiver) ||
        rustExpressionContainsExpansion(statement.index) || rustExpressionContainsExpansion(statement.value);
    case "throw":
      return rustExpressionContainsExpansion(statement.error);
  }
}
