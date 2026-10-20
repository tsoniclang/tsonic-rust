import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { TargetTypeRef, RustSelectedTargetOperation } from "../../../target-model/types/model.js";
import { rustTargetOperationText } from "../../../target-model/operations/text.js";

export function rustSelectedOperatorOperation(
  subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef,
): RustSelectedTargetOperation {
  return { operationId: fact.operationId, operationKind: "operator",
    targetOperation: rustTargetOperationText(fact), resultType, provenance: { sourceExpression: subject } };
}
