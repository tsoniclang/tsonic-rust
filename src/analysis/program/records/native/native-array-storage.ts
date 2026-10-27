import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustNativeMemoryLayoutsEqual, type RustNativeMemoryLayout } from "../../../../target-model/operations/native-memory.js";
import type { RustNativeArrayStorage } from "../../../../target-model/records/native/native-memory.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";

export interface RustNativeArrayStorageProducer {
  readonly records: RustRecordFamily<RustNativeArrayStorage>;
  promote(
    subjects: readonly (readonly [Node, RustNativeArrayStorage["kind"]])[],
    declaration: Node,
    layout: RustNativeMemoryLayout,
    stride: bigint,
    runtimeCarrier: TargetTypeRef,
  ): boolean;
}

export function createRustNativeArrayStorageProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustNativeArrayStorage>,
): RustNativeArrayStorageProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.nativeArrayStorage", equals: nativeArrayStorageEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    promote(
      subjects: readonly (readonly [Node, RustNativeArrayStorage["kind"]])[],
      declaration: Node,
      layout: RustNativeMemoryLayout,
      stride: bigint,
      runtimeCarrier: TargetTypeRef,
    ): boolean {
      assertOpen();
      const candidates = new Map<Node, RustNativeArrayStorage>();
      let conflictingSubject: Node | undefined;
      for (const [subject, kind] of subjects) {
        const candidate = Object.freeze(kind === "element"
          ? { kind, declaration, layout, stride, runtimeCarrier } : { kind, layout, stride, runtimeCarrier });
        const previous = candidates.get(subject);
        if (previous !== undefined && !nativeArrayStorageEquals(previous, candidate)) {
          conflictingSubject ??= subject;
        }
        if (previous === undefined) candidates.set(subject, candidate);
      }
      const admissions: (readonly [Node, RustNativeArrayStorage])[] = [];
      for (const [subject, candidate] of candidates) {
        const previous = family.reader.get(subject);
        if (previous === undefined) {
          admissions.push([subject, candidate]);
        } else {
          if (previous.stride !== stride || !rustNativeMemoryLayoutsEqual(previous.layout, layout)) return false;
          if (!nativeArrayStorageEquals(previous, candidate)) {
            conflictingSubject ??= subject;
          }
        }
      }
      if (conflictingSubject !== undefined) {
        failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.nativeArrayStorage' for one exact source subject.", conflictingSubject);
      }
      for (const [subject, candidate] of admissions) family.writer.set(subject, candidate);
      return true;
    },
  });
}

function nativeArrayStorageEquals(left: RustNativeArrayStorage, right: RustNativeArrayStorage): boolean {
  return left.kind === right.kind &&
    rustTargetTypeRefEquals(left.runtimeCarrier, right.runtimeCarrier) &&
    (left.kind !== "element" || right.kind === "element" && left.declaration === right.declaration) &&
    left.stride === right.stride && rustNativeMemoryLayoutsEqual(left.layout, right.layout);
}
