import type { Node } from "@tsonic/tsts";
import type { RustEmissionProviderOperation } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustProviderEvaluationRecords } from "../../../target-model/records/native/provider-evaluation.js";

export function sourceRuntimeSlots(
  records: RustProviderEvaluationRecords, node: Node, operation: RustEmissionProviderOperation,
) {
  return records.providerSourceOccurrence.get(node, operation)?.slots;
}

export function providerTargetRuntimeSlotKeys(
  records: RustProviderEvaluationRecords, node: Node, operation: RustEmissionProviderOperation,
): readonly string[] | undefined {
  return records.providerSourceOccurrence.get(node, operation)?.targetOrder;
}
