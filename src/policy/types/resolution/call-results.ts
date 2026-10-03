import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/types/value-projections.js";
import type { RustProjectTypePolicy } from "../project-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustProjectProjection } from "../project-projections.js";
import { selectRustFlowReadProjection } from "../value-carrier-reconciliation.js";
import { isRustJsValueCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

export interface RustSourceCallResult {
  readonly nativeType: TargetTypeRef;
  readonly selectedType: TargetTypeRef;
  readonly projection?: RustFlowReadProjectionFact;
}

export function selectRustSourceCallResult(
  projectTypes: RustProjectTypePolicy,
  nativeType: TargetTypeRef,
  selected: () => TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustSourceCallResult | undefined {
  const direct = Object.freeze({ nativeType, selectedType: nativeType });
  const optionalPayload = rustOptionElementCarrier(nativeType);
  const nativePayload = optionalPayload ?? nativeType;
  if (optionalPayload !== undefined || isRustJsValueCarrier(nativePayload) ||
    rustUnionAlternatives(nativePayload, definitions) !== undefined) {
    const selectedType = selected();
    if (selectedType === undefined) return undefined;
    if (rustTargetTypeRefEquals(nativeType, selectedType)) return direct;
    const projection = selectRustFlowReadProjection(nativeType, selectedType, projectTypes, definitions);
    return projection.kind !== "projection" ? undefined : Object.freeze({
      nativeType, selectedType, projection: Object.freeze(projection.fact),
    });
  }
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
    projection: Object.freeze({ kind: "project-downcast", sourceCarrier: nativeType, dispatchCarrier: nativeType, selectedCarrier: selectedType, projection }),
  });
}
