import type { Node } from "@tsonic/tsts";
import type { RustLocationProjection } from "../../../../target-model/records/storage/location-storage.js";
import { createRustRecordFamily } from "../family.js";

export function createRustLocationStorageProducer(assertOpen: () => void) {
  const projections = createRustRecordFamily<RustLocationProjection>({ id: "tsonic.rust.locationProjection", equals: (left, right) => left === right }, assertOpen);
  const references = createRustRecordFamily<Node>({ id: "tsonic.rust.sourceReferenceDeclaration", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ locationProjection: projections.reader, sourceReferenceDeclaration: references.reader }),
    projection: (node: Node, value: RustLocationProjection): void => projections.writer.set(node, Object.freeze(value)),
    reference: (node: Node, declaration: Node): void => references.writer.set(node, declaration) });
}

export type RustLocationStorageProducer = ReturnType<typeof createRustLocationStorageProducer>;
