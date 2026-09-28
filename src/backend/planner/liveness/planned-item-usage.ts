import { rustExpressionChildren } from "../../target-ast/inspection/expression-children.js";
import { rustPatternBindings } from "../../target-ast/patterns.js";
import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustStmt,
} from "../../target-ast/nodes.js";

export function rustPlannedImplementationsReferenceSelfField(
  items: readonly RustItem[],
  fieldName: string,
): boolean {
  return items.some((item) =>
    item.kind === "impl" && item.members.some((member) => member.kind === "macro-invocation" ||
      member.kind === "function" && rustBlockReferencesSelfField(member.body, fieldName)));
}

function rustBlockReferencesSelfField(block: RustBlock, fieldName: string): boolean {
  return block.statements.some((statement) =>
    rustStatementReferencesSelfField(statement, fieldName));
}

function rustStatementReferencesSelfField(
  statement: RustStmt,
  fieldName: string,
): boolean {
  switch (statement.kind) {
    case "macro-statement":
      return true;
    case "item":
      return statement.item.kind === "macro-invocation";
    case "let":
      return rustPatternBindings(statement.pattern) === undefined ||
        (statement.init !== undefined && rustExpressionReferencesSelfField(statement.init, fieldName)) ||
        (statement.else !== undefined && rustBlockReferencesSelfField(statement.else, fieldName));
    case "expr":
    case "tail":
      return rustExpressionReferencesSelfField(statement.expr, fieldName);
    case "assign":
      return rustExpressionReferencesSelfField(statement.target, fieldName) ||
        rustExpressionReferencesSelfField(statement.value, fieldName);
    case "return":
      return statement.expr !== undefined &&
        rustExpressionReferencesSelfField(statement.expr, fieldName);
    case "if":
      return rustExpressionReferencesSelfField(statement.condition, fieldName) ||
        rustBlockReferencesSelfField(statement.then, fieldName) ||
        (statement.else !== undefined &&
          rustBlockReferencesSelfField(statement.else, fieldName));
    case "loop":
    case "scope":
    case "unsafe-scope":
      return rustBlockReferencesSelfField(statement.body, fieldName);
    case "while":
      return rustExpressionReferencesSelfField(statement.condition, fieldName) ||
        rustBlockReferencesSelfField(statement.body, fieldName);
    case "while-let":
      return rustPatternBindings(statement.pattern) === undefined || rustExpressionReferencesSelfField(statement.expression, fieldName) ||
        rustBlockReferencesSelfField(statement.body, fieldName);
    case "if-let":
      return rustPatternBindings(statement.pattern) === undefined || rustExpressionReferencesSelfField(statement.expression, fieldName) ||
        rustBlockReferencesSelfField(statement.body, fieldName) ||
        (statement.else !== undefined &&
          rustBlockReferencesSelfField(statement.else, fieldName));
    case "for":
      return rustPatternBindings(statement.pattern) === undefined || rustExpressionReferencesSelfField(statement.iterable, fieldName) ||
        rustBlockReferencesSelfField(statement.body, fieldName);
    case "completion-exit":
      return statement.expr !== undefined &&
        rustExpressionReferencesSelfField(statement.expr, fieldName);
    case "resource-scope":
      return rustBlockReferencesSelfField(statement.body, fieldName) ||
        rustBlockReferencesSelfField(statement.cleanup, fieldName) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((entry) =>
            rustStatementReferencesSelfField(entry, fieldName)) === true);
    case "index-assign":
      return rustExpressionReferencesSelfField(statement.receiver, fieldName) ||
        rustExpressionReferencesSelfField(statement.index, fieldName) ||
        rustExpressionReferencesSelfField(statement.value, fieldName);
    case "throw":
      return rustExpressionReferencesSelfField(statement.error, fieldName);
    case "try-scope":
      return rustBlockReferencesSelfField(statement.body, fieldName) ||
        (statement.catchClause !== undefined &&
          rustBlockReferencesSelfField(statement.catchClause.body, fieldName)) ||
        (statement.finallyClause !== undefined &&
          rustBlockReferencesSelfField(statement.finallyClause.body, fieldName)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((entry) =>
            rustStatementReferencesSelfField(entry, fieldName)) === true);
    case "break":
    case "continue":
      return false;
  }
}

function rustExpressionReferencesSelfField(
  expression: RustExpr,
  fieldName: string,
): boolean {
  if (expression.kind === "macro-invocation") return true;
  if ((expression.kind === "matches" && rustPatternBindings(expression.pattern) === undefined) ||
    (expression.kind === "match" && expression.arms.some(arm => rustPatternBindings(arm.pattern) === undefined)) ||
    ((expression.kind === "closure" || expression.kind === "closure-block") &&
      expression.params.some(parameter => rustPatternBindings(parameter.pattern) === undefined))) return true;
  if (expression.kind === "field" && expression.name === fieldName &&
    expression.receiver.kind === "path" && expression.receiver.path === "self") {
    return true;
  }
  if (expression.kind === "closure-block") {
    return rustBlockReferencesSelfField(expression.body, fieldName);
  }
  return rustExpressionChildren(expression).some((child) =>
    rustExpressionReferencesSelfField(child, fieldName));
}
