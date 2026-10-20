import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustProviderEvaluationRecords } from "../../../target-model/records/provider-evaluation.js";

export function createRustProviderEvaluationProducer(assertOpen: () => void) {
  const occurrences = new WeakMap<Node, Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>();
  const records: RustProviderEvaluationRecords = Object.freeze({ providerSourceOccurrence: Object.freeze({
    get: (node: Node, operation: RustEmissionProviderOperation) => occurrences.get(node)?.get(operation),
  }) });
  return Object.freeze({ records,
    occurrence(value: RustPhysicalEmissionSourceOccurrence): void {
      assertOpen();
      const selected = occurrences.get(value.node) ?? new Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>();
      if (selected.has(value.operation)) failTargetAnalysisInvariant("tsonic-rust", "A provider source occurrence has one exact native operation owner.", value.node);
      selected.set(value.operation, value);
      occurrences.set(value.node, selected);
    },
  });
}

export type RustProviderEvaluationProducer = ReturnType<typeof createRustProviderEvaluationProducer>;
