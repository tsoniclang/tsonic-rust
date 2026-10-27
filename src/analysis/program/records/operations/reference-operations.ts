import type { Node } from "@tsonic/tsts";
import type { RustReferenceOperationEmission } from "../../../../target-model/records/operations/reference-operations.js";
import { createRustRecordFamily } from "../family.js";

export function createRustReferenceOperationProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustReferenceOperationEmission>({ id: "tsonic.rust.referenceOperation", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ referenceOperation: family.reader }),
    publish: (node: Node, value: RustReferenceOperationEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustReferenceOperationProducer = ReturnType<typeof createRustReferenceOperationProducer>;
