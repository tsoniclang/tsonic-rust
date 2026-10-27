import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFinalizedSliceInput, RustFinalizedSourceInput } from "../../../../target-model/records/operations/finalized-operation.js";
import type { RustProviderInputRecords, RustProviderSliceEmission } from "../../../../target-model/records/native/provider-inputs.js";

export function createRustProviderInputProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<RustFinalizedSliceInput, RustProviderSliceEmission>>();
  const references = new WeakMap<Node, Map<RustFinalizedSourceInput, boolean>>();
  const records: RustProviderInputRecords = Object.freeze({ providerReference: Object.freeze({
    get: (node: Node, input: RustFinalizedSourceInput) => references.get(node)?.get(input),
  }), providerSlice: Object.freeze({
    get: (node: Node, input: RustFinalizedSliceInput) => values.get(node)?.get(input),
  }) });
  return Object.freeze({ records, reference(node: Node, input: RustFinalizedSourceInput, value: boolean): void {
    assertOpen();
    const inputs = references.get(node) ?? new Map<RustFinalizedSourceInput, boolean>();
    if (inputs.has(input)) failTargetAnalysisInvariant("tsonic-rust", "A provider reference has one exact source ABI owner.", node);
    inputs.set(input, value);
    references.set(node, inputs);
  }, slice(node: Node, input: RustFinalizedSliceInput, value: RustProviderSliceEmission): void {
    assertOpen();
    const inputs = values.get(node) ?? new Map<RustFinalizedSliceInput, RustProviderSliceEmission>();
    if (inputs.has(input)) failTargetAnalysisInvariant("tsonic-rust", "A provider slice has one exact source evaluation owner.", node);
    inputs.set(input, Object.freeze(value));
    values.set(node, inputs);
  } });
}

export type RustProviderInputProducer = ReturnType<typeof createRustProviderInputProducer>;
