import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition, RustProjectHeritageEdge } from "./project-types.js";

export function rustProjectClassLineage(
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
      lineage.unshift(current);
      const bases: readonly RustProjectHeritageEdge[] = (
        heritage(current.declaration)
      ).filter((edge) =>
        edge.kind === "extends" && edge.target.kind === "class");
      if (bases.length > 1) {
        return undefined;
      }
      current = bases[0]?.target;
    }
    return Object.freeze(lineage);
  }

export function rustProjectClassContracts(
  definition: RustProjectTypeDefinition,
  heritage: (declaration: Node) => readonly RustProjectHeritageEdge[],
): readonly RustProjectTypeDefinition[] | undefined {
  const lineage = rustProjectClassLineage(definition, heritage);
  if (lineage === undefined) return undefined;
  const result: RustProjectTypeDefinition[] = [];
  const visited = new Set<RustProjectTypeDefinition>();
  const pending = [...lineage].reverse();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    pending.push(...heritage(current.declaration).map(edge => edge.target).reverse());
  }
  return Object.freeze(result);
}
