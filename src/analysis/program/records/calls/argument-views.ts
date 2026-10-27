import type { Node } from "@tsonic/tsts";
import type { RustArgumentView } from "../../../../target-model/records/calls/argument-views.js";
import { createRustRecordFamily } from "../family.js";

export function createRustArgumentViewProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustArgumentView>({ id: "tsonic.rust.argumentView", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ argumentView: family.reader }),
    publish(node: Node, value: RustArgumentView): void { family.writer.set(node, Object.freeze(value)); },
  });
}

export type RustArgumentViewProducer = ReturnType<typeof createRustArgumentViewProducer>;
