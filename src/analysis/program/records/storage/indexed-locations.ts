import type { Node } from "@tsonic/tsts";
import type { RustIndexedLocationEmission } from "../../../../target-model/records/storage/indexed-locations.js";
import { createRustRecordFamily } from "../family.js";

export function createRustIndexedLocationProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustIndexedLocationEmission>({
    id: "tsonic.rust.indexedLocation", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: Object.freeze({ indexedLocation: family.reader }),
    publish: (node: Node, value: RustIndexedLocationEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustIndexedLocationProducer = ReturnType<typeof createRustIndexedLocationProducer>;
