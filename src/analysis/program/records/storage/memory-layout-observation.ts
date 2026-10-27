import type { Node } from "@tsonic/tsts";
import type { RustMemoryLayoutObservationFact } from "../../../../target-model/records/analysis.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustMemoryLayoutObservationProducer {
  readonly records: RustRecordFamily<RustMemoryLayoutObservationFact>;
  observe(expression: Node, value: bigint): void;
}

export function createRustMemoryLayoutObservationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustMemoryLayoutObservationFact>,
): RustMemoryLayoutObservationProducer {
  const family = createRustRecordFamily<RustMemoryLayoutObservationFact>({
    id: "tsonic.rust.memoryLayoutObservation", equals: (left, right) => left.value === right.value,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    observe(expression: Node, value: bigint): void {
      family.writer.set(expression, Object.freeze({ value }));
    },
  });
}
