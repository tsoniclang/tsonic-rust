import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

/** The callable carrier under any optional and reference layers of a stored callable value. */
export function callableValueCarrier(carrier: TargetTypeRef): TargetTypeRef | undefined {
  let current = carrier;
  const visited = new Set<TargetTypeRef>();
  while (!visited.has(current)) {
    visited.add(current);
    const optional = rustOptionElementCarrier(current);
    if (optional !== undefined) current = optional;
    else if (current.kind === "reference") current = current.referent;
    else return current;
  }
  return undefined;
}


/** The values a block-bodied callable returns directly (not from nested callables or classes); undefined for an expression body. */
export function directReturnedValues(ast: AstReader, declaration: Node): readonly Node[] | undefined {
  const body = ast.body(declaration);
  if (body === undefined || !ast.is.IsBlock(body)) return undefined;
  const values: Node[] = [];
  const pending: Node[] = [body];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node !== body && (ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) ||
      ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
      ast.is.IsSetAccessorDeclaration(node) || ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node))) continue;
    if (ast.is.IsReturnStatement(node)) {
      const expression = Node_Expression(ast, node);
      if (expression !== undefined) values.push(expression);
    } else ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return values;
}
