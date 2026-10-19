import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustMemoryLayoutObservationProducer {
  readonly records: RustRecordFamily<{ readonly value: number }>;
  observe(expression: Node, value: number): void;
}

export function createRustMemoryLayoutObservationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<{ readonly value: number }>,
): RustMemoryLayoutObservationProducer {
  const family = createRustRecordFamily<{ readonly value: number }>({
    id: "tsonic.rust.memoryLayoutObservation", equals: (left, right) => left.value === right.value,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    observe(expression: Node, value: number): void {
      family.writer.set(expression, Object.freeze({ value }));
    },
  });
}
