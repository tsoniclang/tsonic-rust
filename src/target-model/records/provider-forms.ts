import type { Node } from "@tsonic/tsts";
import type { RustFinalizedOperationAbi } from "./finalized-operation.js";
import type { RustSourceErrorRegionEmission } from "./error-emission.js";
import type { RustErrorRegionSelection } from "./error-regions.js";
import type { RustValueConversionContract } from "../conversions/contracts.js";

export interface RustProviderFormEmission {
  readonly read: "copy" | "clone" | "storage";
  readonly worker: { readonly fileName: string; readonly argumentIndex: number; readonly mode: "ref" | "value" } | undefined;
  readonly nativeResult: RustSourceErrorRegionEmission | undefined;
  readonly callbackBody: {
    readonly argument: Node;
    readonly region: RustErrorRegionSelection;
    readonly sourceResultFallible: boolean;
    readonly targetResultFallible: boolean;
    readonly invocation: RustSourceErrorRegionEmission | undefined;
    readonly projection: RustValueConversionContract | undefined;
  } | undefined;
}

export interface RustProviderFormRecords {
  readonly providerForm: { readonly get: (node: Node, abi: RustFinalizedOperationAbi, body?: true) => RustProviderFormEmission | undefined };
}
