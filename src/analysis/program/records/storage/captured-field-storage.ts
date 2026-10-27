import { requireRustRecord } from "../objects/required-records.js";
import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustCapturedFieldStorageFact } from "../../../../target-model/records/callables/receiver-captures.js";
import { rustCapturedFieldStorageEquals } from "../../../../target-model/records/operations/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectRustCapturedFieldStorageFact } from "../../../declarations/project-types.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCapturedFieldStorageProducer {
  readonly records: RustRecordFamily<RustCapturedFieldStorageFact>;
  resolve(walk: RustFactWalk, declaration: Node, carrier: TargetTypeRef): void;
}

export function createRustCapturedFieldStorageProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustCapturedFieldStorageFact>,
): RustCapturedFieldStorageProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.capturedFieldStorage",
    equals: rustCapturedFieldStorageEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(walk: RustFactWalk, declaration: Node, carrier: TargetTypeRef): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined) {
        if (!rustTargetTypeRefEquals(existing.valueCarrier, carrier)) {
          failTargetAnalysisInvariant("tsonic-rust",
            "Conflicting Rust semantic plan 'tsonic.rust.capturedFieldStorage' for one exact source subject.", declaration);
        }
        return;
      }
      const selection = selectRustCapturedFieldStorageFact(walk, declaration, carrier);
      if (selection !== undefined) {
        requireRustRecord(walk.context.requiredRecords, "capturedFieldStorage", declaration,
          "captured-field", "capturedFieldStoragePlans.resolve");
        family.writer.set(declaration, selection);
      }
    },
  });
}
