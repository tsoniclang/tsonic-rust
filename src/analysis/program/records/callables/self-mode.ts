import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSelfModeProducer {
  readonly records: RustRecordFamily<{ readonly mode: "ref" | "mut-ref" }>;
  method(member: Node, mode: "ref" | "mut-ref"): void;
}

export function createRustSelfModeProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<{ readonly mode: "ref" | "mut-ref" }>,
): RustSelfModeProducer {
  const family = createRustRecordFamily<{ readonly mode: "ref" | "mut-ref" }>({
    id: "tsonic.rust.selfMode", equals: (left, right) => left.mode === right.mode,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    method(member: Node, mode: "ref" | "mut-ref"): void {
      family.writer.set(member, Object.freeze({ mode }));
    },
  });
}
