import type { Node } from "@tsonic/tsts";
import type { RustUnionEqualityEmission } from "../../../../target-model/records/operations/union-equality.js";
import { createRustRecordFamily } from "../family.js";

export function createRustUnionEqualityProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustUnionEqualityEmission>({ id: "tsonic.rust.unionEquality", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ unionEquality: family.reader }),
    publish: (node: Node, value: RustUnionEqualityEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustUnionEqualityProducer = ReturnType<typeof createRustUnionEqualityProducer>;
