import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
  RustProjectTypeRelationship,
} from "../project-types.js";

export function selectRustProjectRelationship(
  queries: Pick<RustProjectTypePolicy, "definitionForCarrier" | "directSupertypes">,
  source: TargetTypeRef,
  target: RustProjectTypeDefinition,
): RustProjectTypeRelationship {
  const { definitionForCarrier, directSupertypes } = queries;
  const pending: TargetTypeRef[] = [source];
  const visited: TargetTypeRef[] = [];
  const matches: TargetTypeRef[] = [];
  while (pending.length > 0) {
    const candidate = pending.shift()!;
    if (visited.some((entry) => rustTargetTypeRefEquals(entry, candidate))) {
      continue;
    }
    visited.push(candidate);
    const definition = definitionForCarrier(candidate);
    if (definition === target) {
      if (!matches.some((entry) => rustTargetTypeRefEquals(entry, candidate))) {
        matches.push(candidate);
      }
      continue;
    }
    pending.push(...(directSupertypes(candidate) ?? []));
  }
  return matches.length === 0
    ? { kind: "unrelated" }
    : matches.length === 1
      ? { kind: "related", targetType: matches[0]! }
      : { kind: "ambiguous", targetTypes: Object.freeze(matches) };
}

export function selectRustProjectCommonSupertype(
  queries: Pick<RustProjectTypePolicy, "definitionForCarrier" | "relationship" | "openCarrier">,
  reachableDefinitions: (root: RustProjectTypeDefinition) => readonly RustProjectTypeDefinition[],
  carriers: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  const { definitionForCarrier, relationship } = queries;
  if (carriers.length < 2) {
    return undefined;
  }
  const firstDefinition = definitionForCarrier(carriers[0]);
  if (firstDefinition === undefined) return undefined;
  const common = reachableDefinitions(firstDefinition).flatMap((definition) => {
    const relationships = carriers.map((carrier) => relationship(carrier, definition));
    if (relationships.some((selected) => selected.kind !== "related")) {
      return [];
    }
    const targetTypes = relationships.map((selected) =>
      selected.kind === "related" ? selected.targetType : undefined);
    const first = targetTypes[0];
    return first !== undefined && targetTypes.every((target) =>
      target !== undefined && rustTargetTypeRefEquals(target, first))
      ? [{ definition, targetType: first }]
      : [];
  });
  const mostSpecific = common.filter((candidate) => !common.some((other) =>
    other !== candidate && relationship(
      queries.openCarrier(other.definition),
      candidate.definition,
    ).kind === "related"));
  return mostSpecific.length === 1 ? mostSpecific[0]!.targetType : undefined;
}

export function heritageKindIssue(
  source: RustProjectTypeDefinition,
  relation: "extends" | "implements",
  target: RustProjectTypeDefinition,
): string | undefined {
  if (source.kind === "interface") {
    return relation !== "extends"
      ? `Project interface '${source.sourceName}' requires an exact extends instance contract.`
      : undefined;
  }
  return relation === "extends"
    ? target.kind === "class"
      ? undefined
      : `Project class '${source.sourceName}' can extend only another project class.`
    : undefined;
}
