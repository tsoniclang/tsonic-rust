import type { Node } from "@tsonic/tsts";
import type { RustExpressionExit } from "../../../../target-model/records/operations/expression-exits.js";
import { createRustRecordFamily } from "../family.js";

export function createRustExpressionExitProducer(assertOpen: () => void) {
  const exits = createRustRecordFamily<RustExpressionExit>({ id: "tsonic.rust.expressionExit", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ expressionExit: exits.reader }),
    publish: (node: Node, value: RustExpressionExit): void => exits.writer.set(node, Object.freeze(value)) });
}

export type RustExpressionExitProducer = ReturnType<typeof createRustExpressionExitProducer>;
