import type { RustBound, RustWherePredicate } from "./bounds.js";
import type { RustConstExpr } from "./const-expressions.js";
import type { RustSemanticIdentity } from "./identity.js";
import type { RustLifetimeRef } from "./lifetimes.js";
import type { RustTypeRef } from "./types.js";

export type RustGenericParameter =
  | {
      readonly kind: "lifetime";
      readonly identity: RustLifetimeRef;
      readonly bounds: readonly RustLifetimeRef[];
    }
  | {
      readonly kind: "type";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
      readonly bounds: readonly RustBound[];
      readonly defaultType?: RustTypeRef;
    }
  | {
      readonly kind: "const";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
      readonly type: RustTypeRef;
      readonly defaultValue?: RustConstExpr;
    };

export type RustGenericArgument =
  | { readonly kind: "lifetime"; readonly value: RustLifetimeRef }
  | { readonly kind: "type"; readonly value: RustTypeRef }
  | { readonly kind: "const"; readonly value: RustConstExpr };

export type RustCapturedGeneric =
  | { readonly kind: "lifetime"; readonly value: RustLifetimeRef }
  | { readonly kind: "type"; readonly identity: RustSemanticIdentity; readonly displayName: string }
  | { readonly kind: "const"; readonly identity: RustSemanticIdentity; readonly displayName: string };

export interface RustBinder {
  readonly id: string;
  readonly lifetimes: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
}

export interface RustGenerics {
  readonly parameters: readonly RustGenericParameter[];
  readonly wherePredicates: readonly RustWherePredicate[];
}

export const emptyRustGenerics: RustGenerics = Object.freeze({
  parameters: Object.freeze([]),
  wherePredicates: Object.freeze([]),
});
