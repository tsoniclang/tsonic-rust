import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node } from "@tsonic/tsts";
import type { RustFrameCallableDefinition } from "../../../target-model/records/frame-callables.js";
import type { RustProjectConstructionPlan } from "../../project-types/construction-plan.js";

export function prepareRustRetainedFrameCounters(
  definitions: readonly RustFrameCallableDefinition[],
  ast: AstReader,
  constructions: readonly RustProjectConstructionPlan[],
): ReadonlyMap<RustFrameCallableDefinition, string | undefined> {
  const byDeclaration = new Map(constructions.map(plan => [plan.definition.declaration, plan]));
  return new Map(definitions.map(definition => [definition,
    retainedFrameCounterName(definition, ast, byDeclaration.get(definition.activation.ownerDeclaration))]));
}

function retainedFrameCounterName(
  definition: RustFrameCallableDefinition,
  ast: AstReader,
  construction: RustProjectConstructionPlan | undefined,
): string | undefined {
  if (definition.activation.kind === "lexical" || definition.constructionExposure !== undefined) return definition.counterName;
  if (construction === undefined || construction.issues.length !== 0) return definition.counterName;
  for (const implementation of definition.entries.flatMap(entry => entry.implementations)) {
    if (implementation.independent) continue;
    let current = implementation.declaration;
    let constructionOnly = false;
    const visited = new Set<Node>();
    while (true) {
      if (visited.has(current)) failTargetAnalysisInvariant("tsonic-rust", "Retained frame construction ancestry must be acyclic.", current);
      visited.add(current);
      const point = construction.pointFor(current);
      if (point !== undefined) {
        constructionOnly = !point.published && !point.publishBefore;
        break;
      }
      const parent = ast.parent(current);
      if (parent === undefined) break;
      if (ast.is.IsArrowFunction(parent) || ast.is.IsFunctionExpression(parent) ||
        ast.is.IsFunctionDeclaration(parent) || ast.is.IsMethodDeclaration(parent) ||
        ast.is.IsGetAccessorDeclaration(parent) || ast.is.IsSetAccessorDeclaration(parent)) break;
      current = parent;
    }
    if (!constructionOnly) return definition.counterName;
  }
  return undefined;
}
