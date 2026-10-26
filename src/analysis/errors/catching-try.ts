import type { AstReader, Node } from "@tsonic/tsts";
import { isSourceCallableBodyBoundary, TryStatement_CatchClause, TryStatement_TryBlock } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { Node_Initializer } from "@tsonic/target-api/source";
import { isRustProgramErrorCarrier, rustJsErrorTargetType } from "../../target-model/types/index.js";
import { isRustSourceErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
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

export function rustCaughtErrorPhysicalView(ast: AstReader, records: RustProgramRecords, node: Node,
  visiting: Set<Node> = new Set()): TargetTypeRef | undefined {
  const expression = rustUnparenthesizedExpression(ast, node);
  if (visiting.has(expression)) return undefined;
  visiting.add(expression);
  const caught = rustCaughtErrorReadCarrier(ast, records, expression);
  if (caught !== undefined) {
    const fact = records.flowReadProjection.get(expression);
    return rustTargetTypeRefEquals(caught, rustJsErrorTargetType()) && fact?.kind === "builtin-error" &&
      isRustProgramErrorCarrier(fact.sourceCarrier) &&
      (isRustSourceErrorCarrier(fact.selectedCarrier) || rustTargetTypeRefEquals(fact.selectedCarrier, caught)) ? caught : undefined;
  }
  const declaration = records.sourceBinding.get(expression)?.sourceDeclaration;
  if (declaration === undefined || !ast.is.IsVariableDeclaration(declaration) || ast.variableDeclarationKind(declaration) !== "const") return undefined;
  const initializer = Node_Initializer(ast, declaration);
  return initializer === undefined ? undefined : rustCaughtErrorPhysicalDeclaration(ast, records, declaration, visiting);
}

export function rustCaughtErrorPhysicalDeclaration(ast: AstReader, records: RustProgramRecords, declaration: Node,
  visiting: Set<Node> = new Set()): TargetTypeRef | undefined {
  if (!ast.is.IsVariableDeclaration(declaration) || ast.variableDeclarationKind(declaration) !== "const") return undefined;
  const initializer = Node_Initializer(ast, declaration);
  return initializer === undefined ? undefined : rustCaughtErrorPhysicalView(ast, records, initializer, visiting);
}
