import type { Node } from "@tsonic/tsts";
import type { RustObjectReferenceEmission } from "../../../../target-model/records/objects/object-reference-views.js";
import { createRustRecordFamily } from "../family.js";

export function createRustObjectReferenceEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustObjectReferenceEmission>({ id: "tsonic.rust.objectReferenceEmission", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ objectReferenceEmission: family.reader }),
    publish: (node: Node, value: RustObjectReferenceEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustObjectReferenceEmissionProducer = ReturnType<typeof createRustObjectReferenceEmissionProducer>;
