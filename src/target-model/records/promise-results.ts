import type { Node } from "@tsonic/tsts";
import type { SourceExpressionResultDisposition } from "@tsonic/target-api/source";
import type { RustAwaitSelection } from "../types/await.js";

export interface RustDiscardedPromiseLeaf {
  readonly observe: boolean;
}

export interface RustPromiseResult {
  readonly disposition: SourceExpressionResultDisposition;
  readonly discard?: RustAwaitSelection<RustDiscardedPromiseLeaf>;
}

export type RustPromiseResults = ReadonlyMap<Node, RustPromiseResult>;

export type RustPromiseResultUses = ReadonlyMap<Node, SourceExpressionResultDisposition>;
