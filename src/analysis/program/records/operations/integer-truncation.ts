import type { Node } from "@tsonic/tsts";
import type { RustIntegerTruncationEmission } from "../../../../target-model/records/operations/integer-truncation.js";
import { createRustRecordFamily } from "../family.js";

export function createRustIntegerTruncationProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustIntegerTruncationEmission>({ id: "tsonic.rust.integerTruncation", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ integerTruncation: family.reader }),
    publish(node: Node, value: RustIntegerTruncationEmission): void { family.writer.set(node, Object.freeze(value)); },
  });
}

export type RustIntegerTruncationProducer = ReturnType<typeof createRustIntegerTruncationProducer>;
