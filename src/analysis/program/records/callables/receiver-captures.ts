import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustReceiverCaptureEmissionRecords, RustCaptureEnvironmentEmission } from "../../../../target-model/records/callables/receiver-captures.js";

export function createRustReceiverCaptureEmissionProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, WeakMap<Node, boolean>>();
  const environments = new WeakMap<Node, WeakMap<Node, RustCaptureEnvironmentEmission>>();
  const records: RustReceiverCaptureEmissionRecords = Object.freeze({ capturedFieldIdentity: Object.freeze({
    get: (declaration: Node, reference: Node) => values.get(declaration)?.get(reference),
  }), captureEnvironment: Object.freeze({ get: (owner: Node, reference: Node) => environments.get(owner)?.get(reference) }) });
  return Object.freeze({ records,
    environment(owner: Node, reference: Node, value: RustCaptureEnvironmentEmission): void {
      assertOpen();
      const rows = environments.get(owner) ?? new WeakMap<Node, RustCaptureEnvironmentEmission>();
      if (rows.has(reference)) failTargetAnalysisInvariant("tsonic-rust", "A captured binding has one native environment owner.", reference);
      rows.set(reference, Object.freeze(value));
      environments.set(owner, rows);
    },
    publish(declaration: Node, reference: Node, value: boolean): void {
      assertOpen();
      const rows = values.get(declaration) ?? new WeakMap<Node, boolean>();
      if (rows.has(reference)) failTargetAnalysisInvariant("tsonic-rust", "A captured field identity has one native owner.", reference);
      rows.set(reference, value);
      values.set(declaration, rows);
    } });
}
export type RustReceiverCaptureEmissionProducer = ReturnType<typeof createRustReceiverCaptureEmissionProducer>;
