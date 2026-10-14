import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition, RustProjectHeritageEdge } from "../../../target-model/types/project-types.js";

export function projectClassLineage(
  definition: RustProjectTypeDefinition,
  heritage: (declaration: Node) => readonly RustProjectHeritageEdge[],
): readonly RustProjectTypeDefinition[] | undefined {
  if (definition.kind !== "class") {
    return undefined;
  }
  const lineage: RustProjectTypeDefinition[] = [];
  const seen = new Set<RustProjectTypeDefinition>();
  let current: RustProjectTypeDefinition | undefined = definition;
  while (current !== undefined) {
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    lineage.push(current);
    const bases: readonly RustProjectHeritageEdge[] = heritage(current.declaration)
      .filter(edge => edge.kind === "extends" && edge.target.kind === "class");
    if (bases.length > 1) {
      return undefined;
    }
    current = bases[0]?.target;
  }
  return Object.freeze(lineage.reverse());
}

export function projectContractsForLineage(
  lineage: readonly RustProjectTypeDefinition[] | undefined,
  heritage: (declaration: Node) => readonly RustProjectHeritageEdge[],
): readonly RustProjectTypeDefinition[] | undefined {
  if (lineage === undefined) return undefined;
  const result: RustProjectTypeDefinition[] = [];
  const visited = new Set<RustProjectTypeDefinition>();
  const pending = [...lineage].reverse();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const edges = heritage(current.declaration);
    for (let index = edges.length - 1; index >= 0; index -= 1) pending.push(edges[index]!.target);
  }
  return Object.freeze(result);
}
