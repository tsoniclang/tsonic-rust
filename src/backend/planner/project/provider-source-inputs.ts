import type { Node } from "@tsonic/tsts";
import type { RustCallableEmissionContexts, RustEmissionProviderOperation } from "../../../target-model/records/physical-emission-contexts.js";

export function sourceRuntimeSlots(
  contexts: RustCallableEmissionContexts, node: Node, operation: RustEmissionProviderOperation,
) {
  return contexts.sourceFor(node, operation)?.slots;
}

export function providerTargetRuntimeSlotKeys(
  contexts: RustCallableEmissionContexts, node: Node, operation: RustEmissionProviderOperation,
): readonly string[] | undefined {
  return contexts.sourceFor(node, operation)?.targetOrder;
}
