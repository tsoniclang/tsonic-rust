import type { Node } from "@tsonic/tsts";
import type { RustLocationAllocation, RustLocationProjection } from "../../../../target-model/records/storage/location-storage.js";
import { createRustRecordFamily } from "../family.js";

export function createRustLocationStorageProducer(assertOpen: () => void) {
  const allocations = createRustRecordFamily<RustLocationAllocation>({ id: "tsonic.rust.locationAllocation", equals: (left, right) => left === right }, assertOpen);
  const projections = createRustRecordFamily<RustLocationProjection>({ id: "tsonic.rust.locationProjection", equals: (left, right) => left === right }, assertOpen);
  const references = createRustRecordFamily<Node>({ id: "tsonic.rust.sourceReferenceDeclaration", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ locationAllocation: allocations.reader,
    locationProjection: projections.reader, sourceReferenceDeclaration: references.reader }),
    allocation: (node: Node, value: RustLocationAllocation): void => allocations.writer.set(node, Object.freeze(value)),
    projection: (node: Node, value: RustLocationProjection): void => projections.writer.set(node, Object.freeze(value)),
    reference: (node: Node, declaration: Node): void => references.writer.set(node, declaration) });
}

export type RustLocationStorageProducer = ReturnType<typeof createRustLocationStorageProducer>;
