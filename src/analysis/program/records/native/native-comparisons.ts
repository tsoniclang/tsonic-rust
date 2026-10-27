import type { Node } from "@tsonic/tsts";
import type { RustNativeComparison, RustNativeComparisonRecords } from "../../../../target-model/records/native/native-comparisons.js";
import { createRustRecordFamily } from "../family.js";

export function createRustNativeComparisonProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustNativeComparison>({ id: "tsonic.rust.nativeComparison", equals: (left, right) => left === right }, assertOpen);
  const records: RustNativeComparisonRecords = Object.freeze({ nativeComparison: family.reader });
  return Object.freeze({ records, publish: (node: Node, value: RustNativeComparison): void => family.writer.set(node, Object.freeze(value)) });
}

export type RustNativeComparisonProducer = ReturnType<typeof createRustNativeComparisonProducer>;
