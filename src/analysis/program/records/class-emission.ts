import type { Node } from "@tsonic/tsts";
import type { RustNativeClassEmission } from "../../../target-model/records/class-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeMemberVisibility, RustNativeMemberVisibilityRecords } from "../../../target-model/records/native-member-names.js";

export interface RustClassEmissionProducer {
  readonly records: RustRecordFamily<RustNativeClassEmission>;
  readonly visibilityRecords: RustNativeMemberVisibilityRecords;
  visibility(subject: Node, value: RustNativeMemberVisibility): void;
  classDeclaration(subject: Node, value: RustNativeClassEmission): void;
}

export function createRustClassEmissionProducer(assertOpen: () => void): RustClassEmissionProducer {
  const visibility = new WeakMap<Node, RustNativeMemberVisibility>();
  const family = createRustRecordFamily<RustNativeClassEmission>({ id: "tsonic.rust.nativeClass", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    visibilityRecords: Object.freeze({ nativeMemberVisibility: Object.freeze({ get: (subject: Node, publiclyReachable: boolean) => {
      const selected = visibility.get(subject);
      return publiclyReachable ? selected?.public : selected?.internal;
    } }) }),
    visibility(subject: Node, value: RustNativeMemberVisibility): void {
      assertOpen();
      if (visibility.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native member visibility is written exactly once.", subject);
      visibility.set(subject, Object.freeze(value));
    },
    classDeclaration: (subject: Node, value: RustNativeClassEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
