import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustReceiverCaptureEmissionRecords } from "../../../target-model/records/receiver-captures.js";

export function createRustReceiverCaptureEmissionProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, WeakMap<Node, boolean>>();
  const records: RustReceiverCaptureEmissionRecords = Object.freeze({ capturedFieldIdentity: Object.freeze({
    get: (declaration: Node, reference: Node) => values.get(declaration)?.get(reference),
  }) });
  return Object.freeze({ records,
    publish(declaration: Node, reference: Node, value: boolean): void {
      assertOpen();
      const rows = values.get(declaration) ?? new WeakMap<Node, boolean>();
      if (rows.has(reference)) failTargetAnalysisInvariant("tsonic-rust", "A captured field identity has one native owner.", reference);
      rows.set(reference, value);
      values.set(declaration, rows);
    } });
}
export type RustReceiverCaptureEmissionProducer = ReturnType<typeof createRustReceiverCaptureEmissionProducer>;
