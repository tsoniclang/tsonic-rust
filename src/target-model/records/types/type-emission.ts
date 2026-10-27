import type { TargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustUnionPathStep } from "../../types/union-relations.js";

export type RustOptionalStorageEmission =
  | { readonly kind: "unit" }
  | { readonly kind: "option"; readonly element: TargetTypeRef }
  | { readonly kind: "custom"; readonly element: TargetTypeRef }
  | { readonly kind: "union"; readonly absence: readonly RustUnionPathStep[] | undefined };

export type RustSourceOptionalEmission =
  | { readonly kind: "identity" | "unit" | "flatten" | "custom-flatten" | "js-value" }
  | { readonly kind: "custom"; readonly storage: TargetTypeRef };

export type RustOptionPayloadView =
  | { readonly kind: "identity" }
  | { readonly kind: "leaf"; readonly method: "as_ref" | "as_deref" }
  | { readonly kind: "nested"; readonly element: TargetTypeRef };

export interface RustTypePositions {
  readonly opaque: boolean;
  readonly general: boolean;
  readonly parameter: boolean;
  readonly return: boolean;
}

export interface RustTypeEmission {
  readonly errorView: { readonly kind: "program" | "source" | "retained" | "closed" | "other";
    readonly observed: boolean; readonly optional: TargetTypeRef | undefined };
  readonly errorStorage: { readonly kind: "source" | "retained"; readonly path: string; readonly writable: boolean } | undefined;
  readonly option: boolean;
  readonly anonymousOptional: boolean;
  readonly string: boolean;
  readonly sharedStringReference: boolean;
  readonly optionPayload: Readonly<Record<"str" | "shared", RustOptionPayloadView>> | undefined;
  readonly completion: "unit" | "never" | "value";
  readonly promiseObject: boolean;
  readonly discard: "unit" | "value" | "drop";
  readonly emptyRecord: "native-empty" | "structural" | undefined;
  readonly optionalStorage: RustOptionalStorageEmission | undefined;
  readonly sourceOptional: RustSourceOptionalEmission;
  readonly moduleCallableAlias: boolean;
  readonly callArgumentInfer: boolean;
  readonly positions: RustTypePositions;
  readonly constructionArguments: readonly boolean[] | undefined;
  readonly producerError: TargetTypeRef | undefined;
  readonly unionArguments: readonly RustTargetGenericArgument[] | undefined;
  readonly generic: { readonly fileName: string; readonly name: string; readonly arguments: readonly RustTargetGenericArgument[] } | undefined;
  readonly structural: { readonly ownerFileName: string; readonly targetName: string; readonly arguments: readonly RustTargetGenericArgument[];
    readonly handle: boolean; readonly context: TargetTypeRef | undefined } | undefined;
}

export interface RustTypeEmissionRecords {
  readonly typeEmission: { readonly get: (carrier: TargetTypeRef) => RustTypeEmission | undefined };
}
