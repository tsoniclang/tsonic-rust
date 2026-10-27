import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustProjectUnionMapConversion } from "../../../../target-model/conversions/project-union.js";
import type { RustFlowReadProjectionFact } from "../../../../target-model/records/objects/value-projections.js";
import type { RustProjectUnionMappingEmission, RustProjectUnionMappingRecords } from "../../../../target-model/records/types/project-union-mappings.js";

type Upstream = Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined;
export function createRustProjectUnionMappingProducer(assertOpen: () => void) {
  // Keyed by the conversion's closed value: a callable adapter carries an equal conversion object of its own.
  const values = new Map<string, Map<Upstream, RustProjectUnionMappingEmission>>();
  const records: RustProjectUnionMappingRecords = Object.freeze({ projectUnionMapping: Object.freeze({
    get: (conversion: RustProjectUnionMapConversion, upstream: Upstream) => values.get(closedMetadataKey(conversion))?.get(upstream),
  }) });
  return Object.freeze({ records,
    publish(node: Node, conversion: RustProjectUnionMapConversion, upstream: Upstream, value: RustProjectUnionMappingEmission): void {
      assertOpen();
      const key = closedMetadataKey(conversion);
      const rows = values.get(key) ?? new Map<Upstream, RustProjectUnionMappingEmission>();
      if (rows.has(upstream)) failTargetAnalysisInvariant("tsonic-rust", "A project union mapping has one native composition owner.", node);
      rows.set(upstream, Object.freeze(value));
      values.set(key, rows);
    } });
}
export type RustProjectUnionMappingProducer = ReturnType<typeof createRustProjectUnionMappingProducer>;
