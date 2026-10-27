import type { Node } from "@tsonic/tsts";
import type { RustNativeTaskRecords, RustNativeTaskUse } from "../../../../target-model/records/native/native-tasks.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeTaskProducer {
  readonly records: RustNativeTaskRecords;
  use(subject: Node, value: RustNativeTaskUse): void;
}

export function createRustNativeTaskProducer(assertOpen: () => void): RustNativeTaskProducer {
  const family = createRustRecordFamily<RustNativeTaskUse>({ id: "tsonic.rust.nativeTaskUse",
    equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ nativeTaskUse: family.reader }),
    use: (subject: Node, value: RustNativeTaskUse): void => family.writer.set(subject, Object.freeze(value)) });
}
