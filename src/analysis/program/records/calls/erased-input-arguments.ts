import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustErasedInputArgument } from "../../../../target-model/records/calls/erased-input-arguments.js";

export function createRustErasedInputArgumentProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<number, RustErasedInputArgument>>();
  return Object.freeze({ records: Object.freeze({ erasedInputArgument: Object.freeze({
    get: (node: Node, argument: number) => values.get(node)?.get(argument),
  }) }), publish(node: Node, argument: number, value: RustErasedInputArgument): void {
    assertOpen();
    const selected = values.get(node) ?? new Map<number, RustErasedInputArgument>();
    if (selected.has(argument)) failTargetAnalysisInvariant("tsonic-rust", "An erased native input argument has one exact owner.", node);
    selected.set(argument, Object.freeze(value));
    values.set(node, selected);
  } });
}
export type RustErasedInputArgumentProducer = ReturnType<typeof createRustErasedInputArgumentProducer>;
