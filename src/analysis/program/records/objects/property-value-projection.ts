import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustPropertyValueProjectionEmission, RustPropertyValueProjectionRecords } from "../../../../target-model/records/objects/property-value-projection.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function createRustPropertyValueProjectionProducer(assertOpen: () => void) {
  const values = new Map<Node, Map<string, RustPropertyValueProjectionEmission>>();
  const records: RustPropertyValueProjectionRecords = Object.freeze({ propertyValueProjection: Object.freeze({
    get: (node: Node, source: TargetTypeRef) => values.get(node)?.get(closedMetadataKey(source)),
  }) });
  return Object.freeze({ records,
    publish(node: Node, source: TargetTypeRef, value: RustPropertyValueProjectionEmission): void {
      assertOpen();
      const entries = values.get(node) ?? new Map<string, RustPropertyValueProjectionEmission>();
      const key = closedMetadataKey(source);
      if (entries.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A property projection has one exact selected source case.", node);
      entries.set(key, Object.freeze(value)); values.set(node, entries);
    },
  });
}

export type RustPropertyValueProjectionProducer = ReturnType<typeof createRustPropertyValueProjectionProducer>;
