import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustArgumentViewProducer } from "../program/records/argument-views.js";
import { rustBorrowValueIsUnprojected } from "../program/borrowed-element-purity.js";

export function analyzeRustArgumentViews(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustArgumentViewProducer): void {
  for (const node of nodes) {
    const operation = program.records.targetOperation.get(node);
    const read = program.records.readOwnership.get(node);
    producer.publish(node, { slice: operation?.kind === "array-literal" && operation.lane === "native" &&
      operation.contributions.every(contribution => contribution.kind === "value") && program.records.nativeArrayStorage.get(node) === undefined,
      borrowedStorage: read?.readsStorage === true && (read.source.kind === "clone" || read.source.kind === "borrow") &&
        rustBorrowValueIsUnprojected(node, program.records) });
  }
}
