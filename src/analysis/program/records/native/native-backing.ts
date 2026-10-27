import type { Node } from "@tsonic/tsts";
import { rustNativeMemoryLayoutsEqual, type RustNativeMemoryLayout } from "../../../../target-model/operations/native-memory.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeBackingProducer {
  readonly records: RustRecordFamily<RustNativeMemoryLayout>;
  require(subject: Node, layout: RustNativeMemoryLayout): boolean;
}

export function createRustNativeBackingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustNativeMemoryLayout>,
): RustNativeBackingProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeBacking", equals: rustNativeMemoryLayoutsEqual },
    assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    require(subject: Node, layout: RustNativeMemoryLayout): boolean {
      assertOpen();
      const existing = family.reader.get(subject);
      return existing === undefined ? family.admit(subject, layout) === undefined
        : rustNativeMemoryLayoutsEqual(existing, layout);
    },
  });
}
