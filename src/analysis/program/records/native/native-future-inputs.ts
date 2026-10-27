import type { Node } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustNativeFutureInput, RustNativeFutureEnvironmentSelection, RustNativeFutureInputPlan } from "../../../../target-model/records/native/native-future-inputs.js";

export function sealRustNativeFutureInputs(
  environments: ReadonlyMap<Node, RustNativeFutureEnvironmentSelection>,
  subjects: ReadonlyMap<SourceStorageSubject, readonly RustNativeFutureInput[]>,
): RustNativeFutureInputPlan {
  const empty: readonly RustNativeFutureInput[] = Object.freeze([]);
  const unavailable: RustNativeFutureEnvironmentSelection = Object.freeze({ kind: "unresolved",
    reason: "Native Future environment requires an owned callable declaration." });
  return Object.freeze({
    forDeclaration: (declaration: Node) => environments.get(declaration) ?? unavailable,
    forSubject: (subject: SourceStorageSubject) => subjects.get(subject) ?? empty,
  });
}
