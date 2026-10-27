import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { RustFlowReadProjectionFact } from "../../../../target-model/records/objects/value-projections.js";
import type { RustFlowReadEmission } from "../../../../target-model/records/operations/flow-read-emission.js";

export function createRustFlowReadEmissionProducer(assertOpen: () => void) {
  const values = new WeakMap<RustFlowReadProjectionFact, RustFlowReadEmission>();
  return Object.freeze({ records: Object.freeze({ flowReadEmission: Object.freeze({ get: (fact: RustFlowReadProjectionFact) => values.get(fact) }) }),
    publish(node: Node, fact: RustFlowReadProjectionFact, value: RustFlowReadEmission): void {
      assertOpen();
      if (values.has(fact)) failTargetAnalysisInvariant("tsonic-rust", "A flow projection has one native emission owner.", node);
      values.set(fact, Object.freeze(value));
    } });
}
export type RustFlowReadEmissionProducer = ReturnType<typeof createRustFlowReadEmissionProducer>;
