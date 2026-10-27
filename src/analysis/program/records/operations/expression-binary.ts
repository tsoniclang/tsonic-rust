import type { Node } from "@tsonic/tsts";
import type { RustBinaryEmission } from "../../../../target-model/records/operations/expression-binary.js";
import { createRustRecordFamily } from "../family.js";

export function createRustBinaryEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustBinaryEmission>({ id: "tsonic.rust.binaryEmission", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ binaryEmission: family.reader }),
    publish: (node: Node, value: RustBinaryEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustBinaryEmissionProducer = ReturnType<typeof createRustBinaryEmissionProducer>;
