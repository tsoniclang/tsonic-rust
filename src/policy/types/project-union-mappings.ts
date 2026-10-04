import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { selectRustProjectUnionMapConversion } from "../../target-model/conversions/project-union.js";

import { rustProjectUnionUpcastRelation } from "../../target-model/conversions/project-union-relations.js";

export function selectRustProjectUnionMapping(
  source: TargetTypeRef,
  target: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
) {
  return selectRustProjectUnionMapConversion(source, target, definitions, rustProjectUnionUpcastRelation(projectTypes));
}
