import type { Node } from "@tsonic/tsts";
import type { RustSourceCallArgumentEmission } from "../../../target-model/records/source-call-arguments.js";
import { createRustRecordFamily } from "./family.js";

export function createRustSourceCallArgumentProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustSourceCallArgumentEmission>({ id: "tsonic.rust.sourceCallArgument", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ sourceCallArgument: family.reader }),
    publish: (node: Node, value: RustSourceCallArgumentEmission): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustSourceCallArgumentProducer = ReturnType<typeof createRustSourceCallArgumentProducer>;
