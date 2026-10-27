import type { Node } from "@tsonic/tsts";
import type { RustClosedTypeTestSource } from "../../../../target-model/records/types/type-tests.js";
import { createRustRecordFamily } from "../family.js";

export function createRustClosedTypeTestProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustClosedTypeTestSource>({ id: "tsonic.rust.closedTypeTestEmission", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ closedTypeTestEmission: family.reader }),
    publish: (node: Node, value: RustClosedTypeTestSource): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustClosedTypeTestProducer = ReturnType<typeof createRustClosedTypeTestProducer>;
