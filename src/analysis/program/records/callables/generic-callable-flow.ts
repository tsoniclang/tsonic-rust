import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustPhysicalCallableFlowApplication, RustPhysicalCallableFlowRecords } from "../../../../target-model/records/native/physical-callables.js";
import type { RustGenericCallableConversion } from "../../../../target-model/conversions/generic-callable.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustGenericCallableFlowProducer(assertOpen: () => void) {
  const values = new Map<Node, Map<string, RustPhysicalCallableFlowApplication>>();
  const records: RustPhysicalCallableFlowRecords = Object.freeze({ genericCallableFlow: Object.freeze({
    get: (node: Node, conversion: RustGenericCallableConversion, destination: TargetTypeRef | undefined) =>
      values.get(node)?.get(closedMetadataKey([conversion, destination])),
  }) });
  return Object.freeze({ records,
    publish(node: Node, conversion: RustGenericCallableConversion, destination: TargetTypeRef | undefined, value: RustPhysicalCallableFlowApplication): void {
      assertOpen();
      const rows = values.get(node) ?? new Map<string, RustPhysicalCallableFlowApplication>();
      const key = closedMetadataKey([conversion, destination]);
      if (rows.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A generic callable flow has one exact physical destination owner.", node);
      rows.set(key, Object.freeze(value));
      values.set(node, rows);
    },
  });
}
export type RustGenericCallableFlowProducer = ReturnType<typeof createRustGenericCallableFlowProducer>;
