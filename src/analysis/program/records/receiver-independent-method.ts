import type { SourceFile } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustCopiedMethods } from "../../objects/copied-methods.js";
import type { RustFactWalk } from "../walk.js";
import { appendRustDiagnostic } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustReceiverIndependentMethodProducer {
  readonly records: RustRecordFamily<{ readonly carrier: TargetTypeRef }>;
  finalize(walk: RustFactWalk, files: readonly SourceFile[], componentForFile: (fileName: string) => string): ReadonlySet<string>;
}

export function createRustReceiverIndependentMethodProducer(
  assertOpen: () => void,
  inherited?: RustReceiverIndependentMethodProducer["records"],
): RustReceiverIndependentMethodProducer {
  const family = createRustRecordFamily<{ readonly carrier: TargetTypeRef }>({ id: "tsonic.rust.receiverIndependentMethod",
    equals: (left, right) => rustTargetTypeRefEquals(left.carrier, right.carrier) },
    assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(walk: RustFactWalk, files: readonly SourceFile[], componentForFile: (fileName: string) => string): ReadonlySet<string> {
      assertOpen();
      const selection = selectRustCopiedMethods(walk, files, componentForFile);
      for (const [identity, subject] of selection.demands) {
        if (!selection.proven.has(identity)) {
          appendRustDiagnostic(walk, "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN",
            "A retained own method requires a closed callable value whose implementations do not use the original receiver.", subject,
            ["target.capability=rust.object-rest.method-value"]);
          continue;
        }
        for (const method of selection.implementations.get(identity) ?? []) {
          family.writer.set(method.node, { carrier: method.carrier });
        }
      }
      return selection.proven;
    },
  });
}
