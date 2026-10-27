import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFinalizedOperationAbi } from "../../../../target-model/records/operations/finalized-operation.js";
import type { RustProviderFormEmission, RustProviderFormRecords } from "../../../../target-model/records/native/provider-forms.js";

export function createRustProviderFormProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<RustFinalizedOperationAbi, Map<boolean, RustProviderFormEmission>>>();
  const records: RustProviderFormRecords = Object.freeze({ providerForm: Object.freeze({
    get: (node: Node, abi: RustFinalizedOperationAbi, body?: true) => values.get(node)?.get(abi)?.get(body === true),
  }) });
  return Object.freeze({ records, publish(node: Node, abi: RustFinalizedOperationAbi, body: true | undefined, value: RustProviderFormEmission): void {
    assertOpen();
    const operations = values.get(node) ?? new Map<RustFinalizedOperationAbi, Map<boolean, RustProviderFormEmission>>();
    const contexts = operations.get(abi) ?? new Map<boolean, RustProviderFormEmission>();
    if (contexts.has(body === true)) failTargetAnalysisInvariant("tsonic-rust", "A provider form has one exact native emission owner.", node);
    contexts.set(body === true, Object.freeze(value));
    operations.set(abi, contexts);
    values.set(node, operations);
  } });
}

export type RustProviderFormProducer = ReturnType<typeof createRustProviderFormProducer>;
