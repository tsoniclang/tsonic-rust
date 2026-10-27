import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustLiteralEmission, RustLiteralEmissionRecords } from "../../../../target-model/records/operations/literal-emission.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustLiteralEmissionProducer(assertOpen: () => void) {
  const values = new Map<Node, Map<string, RustLiteralEmission>>();
  const records: RustLiteralEmissionRecords = Object.freeze({ literalEmission: Object.freeze({
    get: (node: Node, carrier: TargetTypeRef) => values.get(node)?.get(closedMetadataKey(carrier)),
  }) });
  return Object.freeze({ records, publish(node: Node, carrier: TargetTypeRef, value: RustLiteralEmission): void {
    assertOpen();
    const entries = values.get(node) ?? new Map<string, RustLiteralEmission>();
    const key = closedMetadataKey(carrier);
    if (entries.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A literal has one exact source/native recipe per carrier.", node);
    entries.set(key, Object.freeze(value)); values.set(node, entries);
  } });
}

export type RustLiteralEmissionProducer = ReturnType<typeof createRustLiteralEmissionProducer>;
