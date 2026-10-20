import type { RustProjectTypePolicy, RustProjectTypeDefinition, RustProjectInstanceContract } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function rustProjectInstanceContracts(
  policy: RustProjectTypePolicy,
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): readonly RustProjectInstanceContract[] | undefined {
  const ordered: RustProjectInstanceContract[] = [];
  const visiting = new Set<RustProjectTypeDefinition>();
  const visited = new Map<RustProjectTypeDefinition, TargetTypeRef>();
  const visit = (current: RustProjectTypeDefinition): boolean => {
    const relation = policy.relationship(carrier, current);
    if (relation.kind !== "related") {
      return false;
    }
    const previous = visited.get(current);
    if (previous !== undefined) {
      return rustTargetTypeRefEquals(previous, relation.targetType);
    }
    if (visiting.has(current)) {
      return false;
    }
    visiting.add(current);
    for (const edge of policy.heritageForDefinition(current)) {
      if (!visit(edge.target)) {
        return false;
      }
    }
    visiting.delete(current);
    visited.set(current, relation.targetType);
    ordered.push(Object.freeze({
      definition: current,
      carrier: relation.targetType,
    }));
    return true;
  };
  return visit(definition) ? Object.freeze(ordered) : undefined;
}
