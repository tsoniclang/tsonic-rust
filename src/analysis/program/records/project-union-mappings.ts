import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProjectUnionMapConversion } from "../../../target-model/conversions/project-union.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/value-projections.js";
import type { RustProjectUnionMappingEmission, RustProjectUnionMappingRecords } from "../../../target-model/records/project-union-mappings.js";

type Upstream = Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined;
export function createRustProjectUnionMappingProducer(assertOpen: () => void) {
  const values = new WeakMap<RustProjectUnionMapConversion, Map<Upstream, RustProjectUnionMappingEmission>>();
  const records: RustProjectUnionMappingRecords = Object.freeze({ projectUnionMapping: Object.freeze({
    get: (conversion: RustProjectUnionMapConversion, upstream: Upstream) => values.get(conversion)?.get(upstream),
  }) });
  return Object.freeze({ records,
    publish(node: Node, conversion: RustProjectUnionMapConversion, upstream: Upstream, value: RustProjectUnionMappingEmission): void {
      assertOpen();
      const rows = values.get(conversion) ?? new Map<Upstream, RustProjectUnionMappingEmission>();
      if (rows.has(upstream)) failTargetAnalysisInvariant("tsonic-rust", "A project union mapping has one native composition owner.", node);
      rows.set(upstream, Object.freeze(value));
      values.set(conversion, rows);
    } });
}
export type RustProjectUnionMappingProducer = ReturnType<typeof createRustProjectUnionMappingProducer>;
