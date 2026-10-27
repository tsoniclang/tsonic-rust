import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence } from "../../../../target-model/records/native/physical-emission-contexts.js";
import type { RustMutableProviderOperand, RustProviderEvaluationRecords, RustProviderEvaluationEmission } from "../../../../target-model/records/native/provider-evaluation.js";
import type { SourceExpressionEffects } from "@tsonic/target-api/source";

export function createRustProviderEvaluationProducer(assertOpen: () => void) {
  const occurrences = new WeakMap<Node, Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>();
  const mutable = new WeakMap<Node, Map<RustEmissionProviderOperation, readonly RustMutableProviderOperand[]>>();
  const effects = new WeakMap<Node, SourceExpressionEffects>();
  const evaluations = new WeakMap<Node, Map<RustEmissionProviderOperation, RustProviderEvaluationEmission>>();
  const records: RustProviderEvaluationRecords = Object.freeze({
    providerEvaluation: Object.freeze({ get: (node: Node, operation: RustEmissionProviderOperation) => evaluations.get(node)?.get(operation) }),
    providerMutableOperands: Object.freeze({ get: (node: Node, operation: RustEmissionProviderOperation) => mutable.get(node)?.get(operation) }),
    providerStorageEffects: Object.freeze({ get: (node: Node) => effects.get(node) }),
    providerSourceOccurrence: Object.freeze({
    get: (node: Node, operation: RustEmissionProviderOperation) => occurrences.get(node)?.get(operation),
  }) });
  return Object.freeze({ records,
    evaluation(node: Node, operation: RustEmissionProviderOperation, value: RustProviderEvaluationEmission): void {
      assertOpen();
      const selected = evaluations.get(node) ?? new Map<RustEmissionProviderOperation, RustProviderEvaluationEmission>();
      if (selected.has(operation)) failTargetAnalysisInvariant("tsonic-rust", "A provider evaluation occurrence has one exact source owner.", node);
      selected.set(operation, Object.freeze(value));
      evaluations.set(node, selected);
    },
    mutable(node: Node, operation: RustEmissionProviderOperation, value: readonly RustMutableProviderOperand[]): void {
      assertOpen();
      const selected = mutable.get(node) ?? new Map<RustEmissionProviderOperation, readonly RustMutableProviderOperand[]>();
      if (selected.has(operation)) failTargetAnalysisInvariant("tsonic-rust", "Mutable provider operands have one exact source owner.", node);
      selected.set(operation, Object.freeze(value));
      mutable.set(node, selected);
    },
    effects(node: Node, value: SourceExpressionEffects): void {
      assertOpen();
      if (effects.has(node)) failTargetAnalysisInvariant("tsonic-rust", "Native storage effects have one exact source owner.", node);
      effects.set(node, Object.freeze(value));
    },
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
