import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustIndexedRecordAccessEmission, RustIndexedRecordStorage, RustIndexedRecordStorageEmission, RustIndexedRecordRecords } from "../../../../target-model/records/objects/indexed-records.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustIndexedRecordProducer {
  readonly records: RustIndexedRecordRecords;
  storage(carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage, selected: RustIndexedRecordStorageEmission): void;
  access(node: Node, selected: RustIndexedRecordAccessEmission): void;
  literalKey(property: Node, selected: { readonly kind: "string" | "integer"; readonly value: string }): void;
}

export function createRustIndexedRecordProducer(assertOpen: () => void): RustIndexedRecordProducer {
  const values = new Map<string, RustIndexedRecordStorageEmission>();
  const accesses = new WeakMap<Node, RustIndexedRecordAccessEmission>();
  const keys = new WeakMap<Node, { readonly kind: "string" | "integer"; readonly value: string }>();
  const storageKey = (carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage) => closedMetadataKey([carrier, key, value, storage]);
  return Object.freeze({ records: Object.freeze({
    indexedRecordKey: Object.freeze({ get: (property: Node) => keys.get(property) }),
    indexedRecordStorage: Object.freeze({ get: (carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage) => values.get(storageKey(carrier, key, value, storage)) }),
    indexedRecordAccess: Object.freeze({ get: (node: Node) => accesses.get(node) }),
  }),
    literalKey(property: Node, selected: { readonly kind: "string" | "integer"; readonly value: string }): void {
      assertOpen();
      if (keys.has(property)) failTargetAnalysisInvariant("tsonic-rust", "An indexed literal key has one checked native emission owner.", property);
      keys.set(property, Object.freeze(selected));
    },
    storage(carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage, selected: RustIndexedRecordStorageEmission): void {
      assertOpen();
      const identity = storageKey(carrier, key, value, storage);
      if (values.has(identity)) failTargetAnalysisInvariant("tsonic-rust", "An indexed record storage contract has one source owner.");
      values.set(identity, selected);
    },
    access(node: Node, selected: RustIndexedRecordAccessEmission): void {
      assertOpen();
      if (accesses.has(node)) failTargetAnalysisInvariant("tsonic-rust", "An indexed record access has one source owner.", node);
      accesses.set(node, Object.freeze(selected));
    },
  });
}
