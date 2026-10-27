import { requireRustRecord } from "../../program/records/objects/required-records.js";
import type { Node } from "@tsonic/tsts";
import { recordPolicySelection, rustOperationContext, type RustFactWalk } from "../../program/walk.js";
import type { RustCheckedOperationSelectionResult, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { mapSelectedAssignment } from "./assignments.js";

export function recordRustCompoundWrite(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  resultCarrier: TargetTypeRef,
): void {
  walk.context.records.assertOpen();
  const selected = selectRustCompoundWrite(walk, expression, left, resultCarrier);
  if (selected?.kind === "reject") {
    recordPolicySelection(walk, expression, selected);
    return;
  }
  const fact = selected?.kind === "accept" ? selected.value.targetFact : undefined;
  if (fact?.kind === "runtime-set") {
    requireRustRecord(walk.context.requiredRecords, "compoundWrite", expression, fact.operationId, "recordRustCompoundWrite");
    walk.context.records.compoundWrites.index(expression, fact.operationId, fact.abi);
  }
}

export function selectRustCompoundWrite(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  resultCarrier: TargetTypeRef,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  return mapSelectedAssignment({ expression, left }, resultCarrier, resultCarrier,
    rustOperationContext(walk, left), walk.operationOptions);
}
