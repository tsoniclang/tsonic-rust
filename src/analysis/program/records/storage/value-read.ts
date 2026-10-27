import type { Node } from "@tsonic/tsts";
import type { RustValueRead, RustValueReadRecords } from "../../../../target-model/records/storage/value-read.js";
import { createRustRecordFamily } from "../family.js";
import type { RustPromiseResults, RustPromiseResult } from "../../../../target-model/records/callables/promise-results.js";

export function createRustValueReadProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustValueRead>({ id: "tsonic.rust.valueRead", equals: (left, right) => left === right }, assertOpen);
  const records: RustValueReadRecords = Object.freeze({ valueRead: family.reader });
  const promises = createRustRecordFamily<RustPromiseResult>({ id: "tsonic.rust.promiseResult", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ ...records, promiseResult: promises.reader }),
    promises: (results: RustPromiseResults): void => { for (const [node, result] of results) promises.writer.set(node, Object.freeze(result)); },
    publish: (node: Node, value: RustValueRead): void => family.writer.set(node, Object.freeze(value)) });
}

export type RustValueReadProducer = ReturnType<typeof createRustValueReadProducer>;
