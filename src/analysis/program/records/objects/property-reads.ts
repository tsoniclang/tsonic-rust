import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustBoundMethodEmission, RustPropertyReadRecords } from "../../../../target-model/records/objects/property-reads.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustPropertyReadProducer(assertOpen: () => void) {
  const methods = new WeakMap<Node, Map<string, RustBoundMethodEmission>>();
  const records: RustPropertyReadRecords = Object.freeze({ boundMethod: Object.freeze({
    get: (declaration: Node, receiver: TargetTypeRef, callable: TargetTypeRef) => methods.get(declaration)?.get(closedMetadataKey([receiver, callable])),
  }) });
  return Object.freeze({ records, method(declaration: Node, receiver: TargetTypeRef, callable: TargetTypeRef, value: RustBoundMethodEmission): void {
    assertOpen();
    const values = methods.get(declaration) ?? new Map<string, RustBoundMethodEmission>();
    const key = closedMetadataKey([receiver, callable]);
    if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A bound native method has one exact receiver and callable owner.", declaration);
    values.set(key, Object.freeze(value));
    methods.set(declaration, values);
  } });
}

export type RustPropertyReadProducer = ReturnType<typeof createRustPropertyReadProducer>;
