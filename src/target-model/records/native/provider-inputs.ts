import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSliceInput, RustFinalizedSourceInput } from "../operations/finalized-operation.js";

export interface RustProviderSliceEmission {
  readonly singleton: Node | undefined;
  readonly literals: ReadonlyMap<RustFinalizedSourceInput, string>;
}

export interface RustProviderInputRecords {
  readonly providerSlice: { readonly get: (node: Node, input: RustFinalizedSliceInput) => RustProviderSliceEmission | undefined };
  readonly providerReference: { readonly get: (node: Node, input: RustFinalizedSourceInput) => boolean | undefined };
}
