import type { RustFlowReadProjectionFact } from "../../target-model/types/value-projections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustFlowReadProjectionMatches } from "./flow-read-projections.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { selectRustSourceCallResult } from "../../policy/types/resolution/call-results.js";

export function rustSourceCallResultProjectionMatches(
  selected: RustFlowReadProjectionFact,
  finalized: RustFlowReadProjectionFact,
  instantiate: (carrier: TargetTypeRef) => TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean {
  if (!rustFlowReadProjectionMatches(selected, projectTypes, definitions)) return false;
  const result = selectRustSourceCallResult(projectTypes, instantiate(selected.sourceCarrier),
    () => instantiate(selected.selectedCarrier), definitions);
  return result?.projection !== undefined && closedMetadataEquals(result.projection, finalized);
}
