import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustArgumentViewProducer } from "../program/records/argument-views.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustArgumentViews(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustArgumentViewProducer): void {
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    const read = program.records.readOwnership.get(node);
    producer.publish(node, { slice: operation?.kind === "array-literal" && operation.lane === "native" &&
      operation.contributions.every(contribution => contribution.kind === "value") && program.records.nativeArrayStorage.get(node) === undefined &&
      rustBorrowValueIsUnprojected(node, program.records),
      borrowedStorage: read?.readsStorage === true && (read.source.kind === "clone" || read.source.kind === "borrow") &&
        rustBorrowValueIsUnprojected(node, program.records) });
  }
}
