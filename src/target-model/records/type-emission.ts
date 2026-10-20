import type { TargetTypeRef, RustTargetGenericArgument } from "../types/model.js";

export interface RustTypePositions {
  readonly opaque: boolean;
  readonly general: boolean;
  readonly parameter: boolean;
  readonly return: boolean;
}

export interface RustTypeEmission {
  readonly positions: RustTypePositions;
  readonly constructionArguments: readonly boolean[] | undefined;
  readonly producerError: TargetTypeRef | undefined;
  readonly unionArguments: readonly RustTargetGenericArgument[] | undefined;
  readonly generic: { readonly fileName: string; readonly name: string; readonly arguments: readonly RustTargetGenericArgument[] } | undefined;
  readonly structural: { readonly ownerFileName: string; readonly targetName: string; readonly arguments: readonly RustTargetGenericArgument[];
    readonly handle: boolean } | undefined;
}

export interface RustTypeEmissionRecords {
  readonly typeEmission: { readonly get: (carrier: TargetTypeRef) => RustTypeEmission | undefined };
}
