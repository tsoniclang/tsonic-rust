import type { Node } from "@tsonic/tsts";
import type { RustUnaryEmission } from "../../../../target-model/records/operations/expression-unary.js";
import { createRustRecordFamily } from "../family.js";

export function createRustUnaryEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustUnaryEmission>({ id: "tsonic.rust.unaryEmission", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ unaryEmission: family.reader }),
    publish: (node: Node, value: RustUnaryEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustUnaryEmissionProducer = ReturnType<typeof createRustUnaryEmissionProducer>;
