import type { AstReader, Node } from "@tsonic/tsts";
import { isSourceCallableBodyBoundary, TryStatement_CatchClause, TryStatement_TryBlock } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";

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

export function rustCaughtErrorReadCarrier(ast: AstReader, records: RustProgramRecords,
  node: Node): TargetTypeRef | undefined {
  const expression = rustUnparenthesizedExpression(ast, node);
  const declaration = records.sourceBinding.get(expression)?.sourceDeclaration;
  const clause = declaration === undefined ? undefined : ast.parent(declaration);
  if (clause === undefined || !ast.is.IsCatchClause(clause)) return undefined;
  const binding = records.catchBinding.get(clause);
  if (binding === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted caught read requires its completed protected error region.", node);
  return binding.readCarrier;
}
