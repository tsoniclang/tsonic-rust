import type { RustTargetOperationFact } from "./facts.js";
import type { RustProjectTypePolicy } from "../../../policy/types/project-types.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { closedMetadataEquals, closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";

export function rustClosedTypeTestMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "closed-type-test" }>,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean {
  if (!isRustTargetTypeRef(fact.sourceCarrier) || !isRustTargetTypeRef(fact.targetCarrier) ||
    fact.resultCarrier?.kind !== "source-primitive" || fact.resultCarrier.name !== "bool" ||
    fact.operationId !== `tsonic.rust.closed-type-test.${closedMetadataKey(fact.targetCarrier)}`) return false;
  const selected = selectRustClosedTypeTestPlan(fact.sourceCarrier, fact.targetCarrier, projectTypes, definitions);
  return selected !== undefined && closedMetadataEquals(selected, fact.test);
}
