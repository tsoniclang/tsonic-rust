import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../../target-model/types/carriers/callables.js";
import { selectRustCopiedMethods } from "../../../objects/copied-methods.js";
import type { RustFactWalk } from "../../walk.js";
import { appendRustDiagnostic } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";
import { requireRustRecord } from "../objects/required-records.js";

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
      const proven = new Set<string>();
      const candidates = new Map<Node, TargetTypeRef>();
      for (const [identity, decision] of selection.decisions) {
        if (decision.kind === "rejected") {
          appendRustDiagnostic(walk, "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN",
            `A retained own method requires a closed callable value whose implementations do not use the original receiver. ${decision.reason}`, decision.subject,
            ["target.capability=rust.object-rest.method-value"]);
          continue;
        }
        proven.add(identity);
        for (const method of selection.implementations.get(identity) ?? []) {
          const operation = walk.context.records.targetOperation.get(method.node);
          const retained = operation?.kind === "closure" ? rustCallableProtocol(operation.resultCarrier) : undefined;
          const protocol = rustCallableProtocol(method.carrier);
          const carrier = protocol === undefined ? method.carrier : retained?.lifetime === undefined
            ? failTargetAnalysisInvariant("tsonic-rust", "A receiver-independent method requires its admitted closure retention lifetime.")
            : rustCallableTargetType(protocol.parameters, protocol.result, retained.lifetime, protocol.error);
          requireRustRecord(walk.context.requiredRecords, "receiverIndependentMethod", method.node,
            "copied-method", "receiverIndependentMethods.finalize");
          const pending = candidates.get(method.node);
          const existing = pending ?? family.reader.get(method.node)?.carrier;
          if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
            failTargetAnalysisInvariant("tsonic-rust",
              "Conflicting Rust semantic plan 'tsonic.rust.receiverIndependentMethod' for one exact source subject.");
          }
          if (pending === undefined) candidates.set(method.node, existing ?? carrier);
        }
      }
      for (const [node, carrier] of candidates) family.writer.set(node, Object.freeze({ carrier }));
      return proven;
    },
  });
}
