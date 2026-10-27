import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustOwnershipRecords, RustReadOwnershipFact, RustCaptureReadOwnership } from "../../../../target-model/records/storage/ownership.js";
import type { RustOwnershipEmissionRecords } from "../../../../target-model/records/storage/ownership-emission.js";
import { createRustRecordFamily } from "../family.js";

export function createRustOwnershipEmissionProducer(assertOpen: () => void) {
  let published = false;
  const reads = createRustRecordFamily<RustReadOwnershipFact>({ id: "tsonic.rust.readOwnership", equals: (left, right) => left === right }, assertOpen);
  const captures = createRustRecordFamily<readonly RustCaptureReadOwnership[]>({ id: "tsonic.rust.captureOwnership", equals: (left, right) => left === right }, assertOpen);
  const records: RustOwnershipEmissionRecords = Object.freeze({ readOwnership: reads.reader, captureOwnership: captures.reader });
  return Object.freeze({ records, publish(selection: RustOwnershipRecords): void {
    assertOpen();
    if (published) failTargetAnalysisInvariant("tsonic-rust", "Native ownership emissions have one exact publication.");
    for (const [node, read] of selection.reads) reads.writer.set(node, read);
    for (const [node, capture] of selection.captures) captures.writer.set(node, Object.freeze([...capture]));
    published = true;
  } });
}

export type RustOwnershipEmissionProducer = ReturnType<typeof createRustOwnershipEmissionProducer>;
