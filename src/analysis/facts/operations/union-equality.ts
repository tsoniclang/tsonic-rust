import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustTargetOperationFact } from "./facts.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { selectRustUnionEquality } from "../../../policy/operations/operators/union-equality.js";

export function rustUnionEqualityFactMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "union-equality" }>,
  operator: string | undefined,
  leftCarrier: TargetTypeRef | undefined,
  rightCarrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions,
): boolean {
  if (!isRustTargetTypeRef(fact.leftCarrier) || !isRustTargetTypeRef(fact.rightCarrier) ||
    typeof fact.negated !== "boolean" || typeof fact.exhaustive !== "boolean" ||
    operator !== (fact.negated ? "KindExclamationEqualsEqualsToken" : "KindEqualsEqualsEqualsToken") ||
    !rustTargetTypeRefEquals(leftCarrier, fact.leftCarrier) || !rustTargetTypeRefEquals(rightCarrier, fact.rightCarrier) ||
    !rustTargetTypeRefEquals(fact.resultCarrier, rustSourcePrimitiveTargetType("bool"))) return false;
  const contract = selectRustUnionEquality(fact.leftCarrier, fact.rightCarrier, definitions);
  return contract !== undefined && contract.exhaustive === fact.exhaustive && closedMetadataEquals(contract.arms, fact.arms);
}
