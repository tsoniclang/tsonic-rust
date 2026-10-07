import { KindParenthesizedExpression, Node_Expression } from "@tsonic/target-api/source";
import type { AstReader, Node } from "@tsonic/tsts";

export function rustUnparenthesizedExpression(ast: AstReader, expression: Node): Node {
  let operand = expression;
  while (ast.kindName(operand) === KindParenthesizedExpression) {
    const inner = Node_Expression(ast, operand);
    if (inner === undefined) break;
    operand = inner;
  }
  return operand;
}

export function rustMemberAccessReceiver(ast: AstReader, expression: Node | undefined): Node | undefined {
  return expression !== undefined &&
    (ast.is.IsPropertyAccessExpression(expression) || ast.is.IsElementAccessExpression(expression))
    ? Node_Expression(ast, expression) : undefined;
}
