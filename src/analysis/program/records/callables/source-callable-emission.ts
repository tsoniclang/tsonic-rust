import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustSourceCallableEmission, RustSourceCallableEmissionRecords } from "../../../../target-model/records/callables/source-callable-value.js";

export function createRustSourceCallableEmissionProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, Map<string, RustSourceCallableEmission>>();
  const records: RustSourceCallableEmissionRecords = Object.freeze({ sourceCallableEmission: Object.freeze({
    get: (declaration: Node, carrier: TargetTypeRef) => values.get(declaration)?.get(closedMetadataKey(carrier)),
  }) });
  return Object.freeze({ records,
    publish(declaration: Node, carrier: TargetTypeRef, value: RustSourceCallableEmission): void {
      assertOpen();
      const rows = values.get(declaration) ?? new Map<string, RustSourceCallableEmission>();
      const key = closedMetadataKey(carrier);
      if (rows.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A source callable carrier has one exact construction owner.", declaration);
      rows.set(key, Object.freeze(value));
      values.set(declaration, rows);
    },
  });
}
export type RustSourceCallableEmissionProducer = ReturnType<typeof createRustSourceCallableEmissionProducer>;
