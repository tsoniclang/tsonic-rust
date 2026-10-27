import type { Node } from "@tsonic/tsts";
import type { RustSourceAssertionEmission, RustSourceAssertionRecords } from "../../../../target-model/records/operations/source-assertions.js";
import { createRustRecordFamily } from "../family.js";

export function createRustSourceAssertionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustSourceAssertionEmission>({ id: "tsonic.rust.sourceAssertion", equals: (left, right) => left === right }, assertOpen);
  const records: RustSourceAssertionRecords = Object.freeze({ sourceAssertion: family.reader });
  return Object.freeze({ records, publish: (node: Node, value: RustSourceAssertionEmission): void => family.writer.set(node, Object.freeze(value)) });
}

export type RustSourceAssertionProducer = ReturnType<typeof createRustSourceAssertionProducer>;
