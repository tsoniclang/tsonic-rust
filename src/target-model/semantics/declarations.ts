import type { RustConstExpr } from "./const-expressions.js";
import type { RustBound } from "./bounds.js";
import type { RustGenerics } from "./generics.js";
import type { RustSemanticIdentity } from "./identity.js";
import type { RustAbi, RustReceiver, RustTypeRef } from "./types.js";

export interface RustDialect {
  readonly edition: "2021" | "2024";
  readonly compilerIdentity: string;
  readonly enabledLanguageFeatures: readonly RustFeatureIdentity[];
}

export interface RustFeatureIdentity {
  readonly name: string;
  readonly trackingIssue?: number;
}

export type RustSafety = "safe" | "unsafe";

export interface RustLayout {
  readonly conventions: readonly (
    | { readonly kind: "c" }
    | { readonly kind: "transparent" }
    | { readonly kind: "simd" }
    | {
        readonly kind: "integer";
        readonly representation: import("./types.js").RustPrimitive;
      }
  )[];
  readonly packed?: RustConstExpr;
  readonly alignment?: RustConstExpr;
}

export interface RustCallableSignature {
  readonly identity: RustSemanticIdentity;
  readonly displayName: string;
  readonly generics: RustGenerics;
  readonly receiver?: RustReceiver;
  readonly parameters: readonly RustCallableParameter[];
  readonly result: RustTypeRef;
  readonly safety: RustSafety;
  readonly abi: RustAbi;
  readonly variadic: boolean;
  readonly asynchronous: boolean;
}

export interface RustCallableParameter {
  readonly identity: RustSemanticIdentity;
  readonly displayName: string;
  readonly type: RustTypeRef;
}

export type RustAssociatedItem =
  | {
      readonly kind: "type";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
      readonly generics: RustGenerics;
      readonly bounds: readonly RustBound[];
      readonly defaultType?: RustTypeRef;
    }
  | {
      readonly kind: "constant";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
      readonly type: RustTypeRef;
      readonly defaultValue?: RustConstExpr;
    }
  | {
      readonly kind: "function";
      readonly signature: RustCallableSignature;
      readonly hasDefaultBody: boolean;
    };

export interface RustTraitDeclaration {
  readonly identity: RustSemanticIdentity;
  readonly displayPath: readonly string[];
  readonly generics: RustGenerics;
  readonly safety: RustSafety;
  readonly auto: boolean;
  readonly supertraits: readonly RustBound[];
  readonly items: readonly RustAssociatedItem[];
}

export interface RustImplDeclaration {
  readonly identity: RustSemanticIdentity;
  readonly generics: RustGenerics;
  readonly target: RustTypeRef;
  readonly trait?: import("./types.js").RustTraitRef;
  readonly polarity: "positive" | "negative";
  readonly safety: RustSafety;
  readonly items: readonly RustAssociatedItem[];
}
