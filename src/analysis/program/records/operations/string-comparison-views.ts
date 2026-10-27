import type { Node } from "@tsonic/tsts";
import type { RustStringComparisonView } from "../../../../target-model/records/operations/string-comparison-views.js";
import { createRustRecordFamily } from "../family.js";

export function createRustStringComparisonViewProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustStringComparisonView>({ id: "tsonic.rust.stringComparisonView", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ stringComparisonView: family.reader }),
    publish: (node: Node, value: RustStringComparisonView): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustStringComparisonViewProducer = ReturnType<typeof createRustStringComparisonViewProducer>;
