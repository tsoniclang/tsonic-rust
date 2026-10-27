import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustErrorFieldEmission, RustErrorFieldRecords } from "../../../../target-model/records/errors/error-field-borrows.js";

export function createRustErrorFieldProducer(assertOpen: () => void) {
  const fields = new Map<Node, RustErrorFieldEmission>();
  const snapshots = new Map<Node, Map<Node, boolean>>();
  const records: RustErrorFieldRecords = Object.freeze({
    errorFieldEmission: Object.freeze({ get: (node: Node) => fields.get(node) }),
    errorFieldSnapshot: Object.freeze({ get: (node: Node, later: Node) => snapshots.get(node)?.get(later) }),
  });
  return Object.freeze({ records,
    field(node: Node, value: RustErrorFieldEmission): void {
      assertOpen();
      if (fields.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A native Error field has one source emission owner.", node);
      fields.set(node, Object.freeze(value));
    },
    snapshot(node: Node, later: Node, value: boolean): void {
      assertOpen();
      const rows = snapshots.get(node) ?? new Map<Node, boolean>();
      if (rows.has(later)) failTargetAnalysisInvariant("tsonic-rust", "An Error field snapshot has one source effect owner.", node);
      rows.set(later, value);
      snapshots.set(node, rows);
    },
  });
}
export type RustErrorFieldProducer = ReturnType<typeof createRustErrorFieldProducer>;
