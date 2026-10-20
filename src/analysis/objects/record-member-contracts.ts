import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustProjectTypeDefinition } from "../project-types/type-policy.js";

export function projectRecordMemberImplementation(
  walk: RustFactWalk,
  definition: RustProjectTypeDefinition | undefined,
  contract: Node,
): Node | undefined {
  if (definition === undefined) return undefined;
  const implementation = walk.context.source.navigation.memberImplementation(
    definition.declaration,
    contract,
  );
  return implementation.kind === "resolved"
    ? implementation.implementation.declaration
    : undefined;
}

export function selectedProjectMethodContracts(
  walk: RustFactWalk,
  candidates: readonly Node[],
  selectedDeclarations: readonly Node[],
): readonly Node[] | undefined {
  const candidateSet = new Set(candidates);
  const selected = candidates.filter((candidate) =>
    selectedDeclarations.includes(candidate));
  if (selected.length === 0) return Object.freeze([]);
  const matched = new Set<Node>();
  for (const implementation of selected) {
    matched.add(implementation);
    const contracts = walk.context.source.navigation.memberContracts(implementation);
    if (contracts.kind === "unresolved") return undefined;
    for (const contract of contracts.contracts) {
      if (candidateSet.has(contract)) matched.add(contract);
    }
  }
  return Object.freeze(candidates.filter((candidate) => matched.has(candidate)));
}
