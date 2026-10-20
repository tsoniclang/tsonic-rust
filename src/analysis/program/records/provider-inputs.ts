import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFinalizedSliceInput } from "../../../target-model/records/finalized-operation.js";
import type { RustProviderInputRecords, RustProviderSliceEmission } from "../../../target-model/records/provider-inputs.js";

export function createRustProviderInputProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<RustFinalizedSliceInput, RustProviderSliceEmission>>();
  const records: RustProviderInputRecords = Object.freeze({ providerSlice: Object.freeze({
    get: (node: Node, input: RustFinalizedSliceInput) => values.get(node)?.get(input),
  }) });
  return Object.freeze({ records, slice(node: Node, input: RustFinalizedSliceInput, value: RustProviderSliceEmission): void {
    assertOpen();
    const inputs = values.get(node) ?? new Map<RustFinalizedSliceInput, RustProviderSliceEmission>();
    if (inputs.has(input)) failTargetAnalysisInvariant("tsonic-rust", "A provider slice has one exact source evaluation owner.", node);
    inputs.set(input, Object.freeze(value));
    values.set(node, inputs);
  } });
}

export type RustProviderInputProducer = ReturnType<typeof createRustProviderInputProducer>;
