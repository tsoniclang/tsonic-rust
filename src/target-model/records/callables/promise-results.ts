import type { Node } from "@tsonic/tsts";
import type { SourceExpressionResultDisposition } from "@tsonic/target-api/source";
import type { RustAwaitSelection } from "../../types/await.js";
import type { RustJsRejectionConversion } from "../errors/error-regions.js";

export interface RustDiscardedPromiseLeaf {
  readonly observe: boolean;
  /** A native future discarded on the js surface is spawned on the event loop as an observed task. */
  readonly spawn?: RustDiscardedFutureSpawn;
}

export interface RustDiscardedFutureSpawn {
  /** The local receiver binding the spawned task owns a clone of (the future borrows its receiver). */
  readonly receiver: Node;
  /** The future's error as a JS rejection value; undefined for an infallible future. */
  readonly rejection: Extract<RustJsRejectionConversion, { readonly kind: "identity" | "uninhabited" | "retained-error" }> | undefined;
}

export interface RustPromiseResult {
  readonly disposition: SourceExpressionResultDisposition;
  readonly discard?: RustAwaitSelection<RustDiscardedPromiseLeaf>;
}

export type RustPromiseResults = ReadonlyMap<Node, RustPromiseResult>;

export type RustPromiseResultUses = ReadonlyMap<Node, SourceExpressionResultDisposition>;
