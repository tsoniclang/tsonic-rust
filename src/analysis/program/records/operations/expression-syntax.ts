import type { Node } from "@tsonic/tsts";
import type { RustExpressionSyntax } from "../../../../target-model/records/operations/expression-syntax.js";
import { createRustRecordFamily } from "../family.js";

export function createRustExpressionSyntaxProducer(assertOpen: () => void) {
  const values = createRustRecordFamily<RustExpressionSyntax>({ id: "tsonic.rust.expressionSyntax", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ expressionSyntax: values.reader }),
    publish: (node: Node, value: RustExpressionSyntax): void => values.writer.set(node, Object.freeze(value)) });
}

export type RustExpressionSyntaxProducer = ReturnType<typeof createRustExpressionSyntaxProducer>;
