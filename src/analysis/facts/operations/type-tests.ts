import type { RustTargetOperationFact } from "./facts.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { closedMetadataEquals, closedMetadataKey, hasExactObjectKeys } from "../../../target-model/metadata/closed-data.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";

export function rustClosedTypeTestMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "closed-type-test" }>,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): boolean {
  const predicate = fact.predicate;
  if (fact.kind !== "closed-type-test" || typeof predicate !== "object" || predicate === null ||
    !(predicate.kind === "array" ? hasExactObjectKeys(predicate, ["kind"])
      : predicate.kind === "error" ? hasExactObjectKeys(predicate, ["kind", "errorKind"]) &&
        ["any", "RangeError", "TypeError", "URIError"].includes(predicate.errorKind)
      : predicate.kind === "nominal" && hasExactObjectKeys(predicate, ["kind", "targetCarrier"]) &&
        isRustTargetTypeRef(predicate.targetCarrier))) return false;
  if (!isRustTargetTypeRef(fact.sourceCarrier) ||
    fact.resultCarrier?.kind !== "source-primitive" || fact.resultCarrier.name !== "bool" ||
    fact.operationId !== `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`) return false;
  const selected = selectRustClosedTypeTestPlan(fact.sourceCarrier, predicate, projectTypes, definitions);
  return selected !== undefined && closedMetadataEquals(selected, fact.test);
}
