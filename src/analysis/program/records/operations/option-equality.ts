import type { Node } from "@tsonic/tsts";
import type { RustOptionEqualityEmission } from "../../../../target-model/records/operations/option-equality.js";
import { createRustRecordFamily } from "../family.js";

export function createRustOptionEqualityProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustOptionEqualityEmission>({ id: "tsonic.rust.optionEquality", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ optionEquality: family.reader }),
    publish: (node: Node, value: RustOptionEqualityEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustOptionEqualityProducer = ReturnType<typeof createRustOptionEqualityProducer>;
