import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustReceiverCaptureEmissionRecords, RustCaptureEnvironmentEmission } from "../../../../target-model/records/callables/receiver-captures.js";

export function createRustReceiverCaptureEmissionProducer(assertOpen: () => void) {
  const environments = new WeakMap<Node, WeakMap<Node, RustCaptureEnvironmentEmission>>();
  const records: RustReceiverCaptureEmissionRecords = Object.freeze({
    captureEnvironment: Object.freeze({ get: (owner: Node, reference: Node) => environments.get(owner)?.get(reference) }),
  });
  return Object.freeze({ records,
    environment(owner: Node, reference: Node, value: RustCaptureEnvironmentEmission): void {
      assertOpen();
      const rows = environments.get(owner) ?? new WeakMap<Node, RustCaptureEnvironmentEmission>();
      if (rows.has(reference)) failTargetAnalysisInvariant("tsonic-rust", "A captured binding has one native environment owner.", reference);
      rows.set(reference, Object.freeze(value));
      environments.set(owner, rows);
    } });
}
export type RustReceiverCaptureEmissionProducer = ReturnType<typeof createRustReceiverCaptureEmissionProducer>;
