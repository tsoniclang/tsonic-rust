import type { Node } from "@tsonic/tsts";
import type { RustFinalizedOperationAbi } from "./finalized-operation.js";

export interface RustProviderFormEmission {
  readonly read: "copy" | "clone" | "storage";
  readonly worker: { readonly fileName: string; readonly argumentIndex: number; readonly mode: "ref" | "value" } | undefined;
}

export interface RustProviderFormRecords {
  readonly providerForm: { readonly get: (node: Node, abi: RustFinalizedOperationAbi, body?: true) => RustProviderFormEmission | undefined };
}
