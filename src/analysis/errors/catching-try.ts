import type { AstReader, Node } from "@tsonic/tsts";
import { isSourceCallableBodyBoundary, TryStatement_CatchClause, TryStatement_TryBlock } from "@tsonic/target-api/source";

// Whether a node's errors reach the catch clause of a try body in its own callable: the planner then propagates into
// the package (program error) boundary of that catch rather than into the callable's error region.
export function rustNodeInCatchingTryBody(ast: AstReader, node: Node): boolean {
  let child = node;
  for (let current = ast.parent(node); current !== undefined; child = current, current = ast.parent(current)) {
    if (ast.is.IsTryStatement(current) && TryStatement_TryBlock(ast, current) === child && TryStatement_CatchClause(ast, current) !== undefined)
      return true;
    if (isSourceCallableBodyBoundary(ast, current)) return false;
  }
  return false;
}
