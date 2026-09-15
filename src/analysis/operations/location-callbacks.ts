import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustCallableTargetType, rustClosureTargetType } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustLocationCallbackCarrier(
  expression: Node,
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  ast: AstReader,
): TargetTypeRef {
  let subject = expression;
  while (ast.kindName(subject) === "KindParenthesizedExpression") {
    const inner = Node_Expression(ast, subject);
    if (inner === undefined) break;
    subject = inner;
  }
  return ast.kindName(subject) === "KindArrowFunction" || ast.kindName(subject) === "KindFunctionExpression"
    ? rustClosureTargetType(parameters, result, true)
    : rustCallableTargetType(parameters, result);
}
