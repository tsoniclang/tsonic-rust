import type { Node } from "@tsonic/tsts";
import { type SourceControlFlowGraph, type SourceFlowLivenessSelection } from "@tsonic/target-api/analysis";

export interface RustOwnershipFlow {
  readonly regions: readonly { readonly graph: SourceControlFlowGraph;
    readonly liveness: Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }> }[];
  readonly movingReads: ReadonlySet<Node>;
  readonly captureTransfers: ReadonlyMap<Node, ReadonlySet<Node>>;
}
