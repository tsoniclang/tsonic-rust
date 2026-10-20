import type { Node } from "@tsonic/tsts";
import type { RustValueRead, RustValueReadRecords } from "../../../target-model/records/value-read.js";
import { createRustRecordFamily } from "./family.js";

export function createRustValueReadProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustValueRead>({ id: "tsonic.rust.valueRead", equals: (left, right) => left === right }, assertOpen);
  const records: RustValueReadRecords = Object.freeze({ valueRead: family.reader });
  return Object.freeze({ records, publish: (node: Node, value: RustValueRead): void => family.writer.set(node, Object.freeze(value)) });
}

export type RustValueReadProducer = ReturnType<typeof createRustValueReadProducer>;
