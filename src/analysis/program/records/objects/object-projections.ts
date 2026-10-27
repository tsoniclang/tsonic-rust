import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustErrorDomain } from "../../../../target-model/operations/error-boundary.js";
import type { RustClosedNativeProjectionEmission, RustProjectProjectionEmission, RustProjectClosedValueEmission, RustObjectProjectionRecords } from "../../../../target-model/records/objects/object-projections.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustObjectProjectionProducer {
  readonly records: RustObjectProjectionRecords;
  closed(node: Node, source: TargetTypeRef, target: TargetTypeRef, domain: RustErrorDomain, value: RustClosedNativeProjectionEmission): void;
  project(node: Node, source: TargetTypeRef, target: TargetTypeRef, value: RustProjectProjectionEmission): void;
  value(carrier: TargetTypeRef, value: RustProjectClosedValueEmission): void;
}

export function createRustObjectProjectionProducer(assertOpen: () => void): RustObjectProjectionProducer {
  const closed = new WeakMap<Node, Map<string, RustClosedNativeProjectionEmission>>();
  const projects = new WeakMap<Node, Map<string, RustProjectProjectionEmission>>();
  const values = new Map<string, RustProjectClosedValueEmission>();
  return Object.freeze({ records: Object.freeze({
    closedNativeProjection: Object.freeze({ get: (node: Node, source: TargetTypeRef, target: TargetTypeRef, domain: RustErrorDomain) => closed.get(node)?.get(closedMetadataKey([source, target, domain])) }),
    projectProjection: Object.freeze({ get: (node: Node, source: TargetTypeRef, target: TargetTypeRef) => projects.get(node)?.get(closedMetadataKey([source, target])) }),
    projectClosedValue: Object.freeze({ get: (carrier: TargetTypeRef) => values.get(closedMetadataKey(carrier)) }),
  }),
    closed(node: Node, source: TargetTypeRef, target: TargetTypeRef, domain: RustErrorDomain, value: RustClosedNativeProjectionEmission): void {
      assertOpen();
      let contexts = closed.get(node);
      if (contexts === undefined) { contexts = new Map(); closed.set(node, contexts); }
      const key = closedMetadataKey([source, target, domain]);
      if (contexts.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A closed native projection has one source and ABI owner.", node);
      contexts.set(key, value);
    },
    project(node: Node, source: TargetTypeRef, target: TargetTypeRef, value: RustProjectProjectionEmission): void {
      assertOpen();
      let contexts = projects.get(node);
      if (contexts === undefined) { contexts = new Map(); projects.set(node, contexts); }
      const key = closedMetadataKey([source, target]);
      if (contexts.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A project projection has one source owner.", node);
      contexts.set(key, Object.freeze(value));
    },
    value(carrier: TargetTypeRef, value: RustProjectClosedValueEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A closed project value has one source owner.");
      values.set(key, Object.freeze(value));
    },
  });
}
