import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustLocationCallbackEmission } from "../../../../target-model/records/callables/location-callbacks.js";

export function createRustLocationCallbackProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<number, RustLocationCallbackEmission>>();
  return Object.freeze({ records: Object.freeze({ locationCallback: Object.freeze({
    get: (node: Node, argument: number) => values.get(node)?.get(argument),
  }) }), publish(node: Node, argument: number, value: RustLocationCallbackEmission): void {
    assertOpen();
    const selected = values.get(node) ?? new Map<number, RustLocationCallbackEmission>();
    if (selected.has(argument)) failTargetAnalysisInvariant("tsonic-rust", "A native location callback has one exact adapter owner.", node);
    selected.set(argument, Object.freeze(value));
    values.set(node, selected);
  } });
}
export type RustLocationCallbackProducer = ReturnType<typeof createRustLocationCallbackProducer>;
