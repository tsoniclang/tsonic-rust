import type { Node } from "@tsonic/tsts";
import { rustNativeMemoryLayoutsEqual, type RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import type { RustNativeArrayStorage } from "../../../target-model/records/native-memory.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustNativeArrayStorageProducer {
  readonly records: RustRecordFamily<RustNativeArrayStorage>;
  promote(
    subjects: readonly (readonly [Node, RustNativeArrayStorage["kind"]])[],
    declaration: Node,
    layout: RustNativeMemoryLayout,
    stride: number,
  ): boolean;
}

export function createRustNativeArrayStorageProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustNativeArrayStorage>,
): RustNativeArrayStorageProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeArrayStorage", equals: (
    left: RustNativeArrayStorage, right: RustNativeArrayStorage,
  ) => left.kind === right.kind && (left.kind !== "element" || right.kind === "element" && left.declaration === right.declaration) &&
    left.stride === right.stride && rustNativeMemoryLayoutsEqual(left.layout, right.layout) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    promote(
      subjects: readonly (readonly [Node, RustNativeArrayStorage["kind"]])[],
      declaration: Node,
      layout: RustNativeMemoryLayout,
      stride: number,
    ): boolean {
      assertOpen();
      if (!subjects.every(([subject]) => {
        const previous = family.reader.get(subject);
        return previous === undefined || previous.stride === stride && rustNativeMemoryLayoutsEqual(previous.layout, layout);
      })) return false;
      for (const [subject, kind] of subjects) family.writer.set(subject, Object.freeze(kind === "element"
        ? { kind, declaration, layout, stride } : { kind, layout, stride }));
      return true;
    },
  });
}
