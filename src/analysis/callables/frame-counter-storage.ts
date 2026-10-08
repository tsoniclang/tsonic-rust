import type { AstReader } from "@tsonic/tsts";
import type { RustFrameCallableDefinition } from "./frame-values.js";
import type { RustProjectConstructionQueries } from "../project-types/construction-plan.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";

export function rustRetainedFrameCounterName(
  definition: RustFrameCallableDefinition,
  input: { readonly source: { readonly ast: AstReader }; readonly projectTypes: RustProjectTypePolicy;
    readonly projectConstructions: RustProjectConstructionQueries },
): string | undefined {
  if (definition.activation.kind === "lexical" || definition.constructionExposure !== undefined) return definition.counterName;
  const owner = input.projectTypes.definitionForDeclaration(definition.activation.ownerDeclaration);
  const construction = owner === undefined ? undefined : input.projectConstructions.forDefinition(owner);
  if (construction === undefined || construction.issues.length !== 0) return definition.counterName;
  for (const implementation of definition.entries.flatMap(entry => entry.implementations)) {
    if (implementation.independent) continue;
    let current = implementation.declaration;
    let constructionOnly = false;
    for (let depth = 0; depth < 256; depth += 1) {
      const point = construction.pointFor(current);
      if (point !== undefined) {
        constructionOnly = !point.published && !point.publishBefore;
        break;
      }
      const parent = input.source.ast.parent(current);
      if (parent === undefined) break;
      if (input.source.ast.is.IsArrowFunction(parent) || input.source.ast.is.IsFunctionExpression(parent) ||
        input.source.ast.is.IsFunctionDeclaration(parent) || input.source.ast.is.IsMethodDeclaration(parent) ||
        input.source.ast.is.IsGetAccessorDeclaration(parent) || input.source.ast.is.IsSetAccessorDeclaration(parent)) break;
      current = parent;
    }
    if (!constructionOnly) return definition.counterName;
  }
  return undefined;
}
