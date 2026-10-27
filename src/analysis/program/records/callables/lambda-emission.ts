import type { Node } from "@tsonic/tsts";
import type { RustLambdaEmission } from "../../../../target-model/records/callables/lambda-emission.js";
import { createRustRecordFamily } from "../family.js";

export function createRustLambdaEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustLambdaEmission>({ id: "tsonic.rust.lambdaBody", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ lambdaBody: family.reader }),
    lambda(node: Node, value: RustLambdaEmission): void { family.writer.set(node, Object.freeze(value)); },
  });
}

export type RustLambdaEmissionProducer = ReturnType<typeof createRustLambdaEmissionProducer>;
