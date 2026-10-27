import { sourceMarkerFactKey, type Node, type ReadonlySourceFactResolver } from "@tsonic/tsts";
import { selectRustNativeHandler } from "../../policy/operations/pointers/native-handlers.js";
import { selectRustNativePointerOperation } from "../../policy/operations/pointers/native-pointers.js";
import type { RustSafetyOperation } from "../../target-model/records/storage/safety.js";
import type { RustProgramRecordWriter } from "../program/records/model.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustNativeHandlers(
  nodes: readonly Node[],
  records: RustProgramRecordWriter,
  safetyOperations: { readonly get: (node: Node) => RustSafetyOperation | undefined },
  sourceFacts: ReadonlySourceFactResolver,
  requirements: RustRequiredRecord[],
): void {
  for (const node of nodes) {
    const operation = records.targetOperation.get(node);
    const pointer = selectRustNativePointerOperation(records.rawLocationPlan.get(node), records.memoryLayoutObservation.get(node),
      records.rawAddressPlan.get(node), operation);
    const selected = selectRustNativeHandler(records.memoryBindingPlan.get(node), safetyOperations.get(node),
      sourceFacts.getFact(node, sourceMarkerFactKey), operation, pointer, records.typedLocationPlan.get(node));
    if (selected === undefined) continue;
    requireRustRecord(requirements, "nativeHandler", node, selected.kind, "analyzeRustNativeHandlers");
    records.nativeHandlers.selected(node, selected);
  }
}
