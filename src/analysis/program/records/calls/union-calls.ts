import type { Node } from "@tsonic/tsts";
import type { RustUnionCallEmission } from "../../../../target-model/records/calls/union-calls.js";
import { createRustRecordFamily } from "../family.js";

export function createRustUnionCallProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustUnionCallEmission>({ id: "tsonic.rust.unionCall", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ unionCall: family.reader }),
    publish: (node: Node, value: RustUnionCallEmission): void => family.writer.set(node, Object.freeze(value)),
  });
}

export type RustUnionCallProducer = ReturnType<typeof createRustUnionCallProducer>;
