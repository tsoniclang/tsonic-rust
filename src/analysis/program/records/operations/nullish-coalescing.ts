import type { Node } from "@tsonic/tsts";
import type { RustNullishCoalescingEmission } from "../../../../target-model/records/operations/nullish-coalescing.js";
import { createRustRecordFamily } from "../family.js";

export function createRustNullishCoalescingProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustNullishCoalescingEmission>({ id: "tsonic.rust.nullishCoalescing", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ nullishCoalescing: family.reader }),
    publish: (node: Node, value: RustNullishCoalescingEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustNullishCoalescingProducer = ReturnType<typeof createRustNullishCoalescingProducer>;
