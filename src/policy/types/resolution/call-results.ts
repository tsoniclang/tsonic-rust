import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectDowncastFact } from "../../../target-model/types/project-projections.js";
import type { RustProjectTypePolicy } from "../project-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustProjectProjection } from "../project-projections.js";

export interface RustSourceCallResult {
  readonly nativeType: TargetTypeRef;
  readonly selectedType: TargetTypeRef;
  readonly projection?: RustProjectDowncastFact;
}

export function selectRustSourceCallResult(
  projectTypes: RustProjectTypePolicy,
  nativeType: TargetTypeRef,
  selected: () => TargetTypeRef | undefined,
): RustSourceCallResult | undefined {
  const direct = Object.freeze({ nativeType, selectedType: nativeType });
  const source = projectTypes.definitionForCarrier(nativeType);
  if (source === undefined) return direct;
  const selectedType = selected();
  if (selectedType === undefined || rustTargetTypeRefEquals(nativeType, selectedType)) return direct;
  const relation = projectTypes.relationship(selectedType, source);
  if (relation.kind !== "related" || !rustTargetTypeRefEquals(relation.targetType, nativeType)) return direct;
  const projection = selectRustProjectProjection(nativeType, selectedType, projectTypes);
  return projection === undefined ? undefined : Object.freeze({
    nativeType,
    selectedType,
    projection: Object.freeze({ sourceCarrier: nativeType, dispatchCarrier: nativeType, targetCarrier: selectedType, projection }),
  });
}
