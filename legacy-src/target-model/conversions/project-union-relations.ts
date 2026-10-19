import type { RustProjectTypePolicy } from "../types/project-types.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import type { RustProjectUpcastRelation } from "./project-union.js";

export function rustProjectUnionUpcastRelation(projectTypes: RustProjectTypePolicy): RustProjectUpcastRelation {
  return (source, target) => {
    const sourceDefinition = projectTypes.definitionForCarrier(source);
    const targetDefinition = projectTypes.definitionForCarrier(target);
    if (sourceDefinition === undefined || targetDefinition === undefined) return "unrelated";
    const selected = projectTypes.relationship(source, targetDefinition);
    return selected.kind === "ambiguous" ? "ambiguous"
      : selected.kind === "related" && rustTargetTypeRefEquals(selected.targetType, target) ? "related" : "unrelated";
  };
}
