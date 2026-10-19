import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, sourceNodesEqual } from "@tsonic/target-api/source";

export function rustSourceValueWrapperContains(wrapper: Node, expression: Node, ast: AstReader): boolean {
  return (ast.is.IsParenthesizedExpression(wrapper) || ast.is.IsAsExpression(wrapper) ||
    ast.is.IsSatisfiesExpression(wrapper) || ast.is.IsNonNullExpression(wrapper) ||
    ast.is.IsTypeAssertion(wrapper)) && sourceNodesEqual(ast, Node_Expression(ast, wrapper), expression);
}
