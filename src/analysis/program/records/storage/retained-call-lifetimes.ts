import type { Node } from "@tsonic/tsts";
import { rustLifetimesEqual, type RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import type { RustProgramRecords, RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

type RustRetainedCallLifetimes = Exclude<ReturnType<RustProgramRecords["retainedCallLifetimes"]["get"]>, undefined>;

export interface RustRetainedCallLifetimesProducer {
  readonly records: RustRecordFamily<RustRetainedCallLifetimes>;
  finalize(call: Node, lifetimes: ReadonlyMap<string, RustLifetimeRef>): void;
}

export function createRustRetainedCallLifetimesProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustRetainedCallLifetimes>,
): RustRetainedCallLifetimesProducer {
  const family = createRustRecordFamily<RustRetainedCallLifetimes>({
    id: "tsonic.rust.retainedCallLifetimes",
    equals: (left, right) => left.length === right.length && left.every((entry, index) =>
      entry.identity === right[index]?.identity && rustLifetimesEqual(entry.lifetime, right[index]?.lifetime)),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(call: Node, lifetimes: ReadonlyMap<string, RustLifetimeRef>): void {
      assertOpen();
      if (lifetimes.size === 0) return;
      family.writer.set(call, Object.freeze([...lifetimes].map(([identity, lifetime]) => Object.freeze({ identity, lifetime }))));
    },
  });
}
