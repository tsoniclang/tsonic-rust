import type { RustTargetOperationFact } from "./facts.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { closedMetadataEquals, closedMetadataKey, hasExactObjectKeys } from "../../../target-model/metadata/closed-data.js";
import { selectRustClosedTypeTestPlan, selectRustProjectTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";

export function rustProjectTypeTestMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "project-type-test" }>,
  projectTypes: RustProjectTypePolicy,
): boolean {
  if (!hasExactObjectKeys(fact, ["kind", "operationId", "sourceCarrier", "dispatchCarrier", "targetCarrier", "lowering", "resultCarrier"]) ||
    !isRustTargetTypeRef(fact.sourceCarrier) || !isRustTargetTypeRef(fact.dispatchCarrier) ||
    !isRustTargetTypeRef(fact.targetCarrier) ||
    fact.resultCarrier?.kind !== "source-primitive" || fact.resultCarrier.name !== "bool") return false;
  const selected = selectRustProjectTypeTestPlan(fact.sourceCarrier, fact.targetCarrier, projectTypes);
  return selected !== undefined &&
    fact.operationId === `tsonic.rust.project-type-test.${selected.lowering.kind}` &&
    closedMetadataEquals({ sourceCarrier: fact.sourceCarrier, dispatchCarrier: fact.dispatchCarrier,
      targetCarrier: fact.targetCarrier, lowering: fact.lowering }, selected);
}

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
