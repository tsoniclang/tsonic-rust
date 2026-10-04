import type { RustFlowReadProjectionFact } from "../../target-model/types/value-projections.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";

export function rustFlowReadProjectionMatches(
  fact: RustFlowReadProjectionFact, projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions,
): boolean {
  if (!isRustTargetTypeRef(fact.sourceCarrier) || !isRustTargetTypeRef(fact.selectedCarrier)) return false;
  const selected = selectRustFlowReadProjection(fact.sourceCarrier, fact.selectedCarrier, projectTypes, definitions);
  return selected.kind === "projection" && closedMetadataEquals(selected.fact, fact);
}
