import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustProjectTypePolicy } from "./project-types.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustProjectUnionMapConversion, type RustProjectUpcastRelation } from "../../target-model/conversions/project-union.js";

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

export function selectRustProjectUnionMapping(
  source: TargetTypeRef,
  target: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
) {
  return selectRustProjectUnionMapConversion(source, target, definitions, rustProjectUnionUpcastRelation(projectTypes));
}
