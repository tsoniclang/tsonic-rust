import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustCapturedFieldStorageFact } from "../../../target-model/records/receiver-captures.js";
import { rustCapturedFieldStorageEquals } from "../../../target-model/records/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { selectRustCapturedFieldStorageFact } from "../../declarations/project-types.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

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
      const selection = selectRustCapturedFieldStorageFact(walk, declaration, carrier);
      if (selection !== undefined) family.writer.set(declaration, selection);
    },
  });
}
