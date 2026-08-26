import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustBound } from "./bounds.js";
import type { RustConstExpr } from "./const-expressions.js";
import type {
  RustBinder,
  RustCapturedGeneric,
  RustGenericArgument,
} from "./generics.js";
import type { RustSemanticIdentity } from "./identity.js";
import type { RustLifetimeRef } from "./lifetimes.js";

export type RustAbi =
  | "Rust"
  | "C"
  | "C-unwind"
  | "system"
  | "system-unwind"
  | "cdecl"
  | "stdcall"
  | "fastcall"
  | "vectorcall"
  | "thiscall"
  | "aapcs"
  | "win64"
  | "sysv64"
  | "efiapi";

export type RustPrimitive =
  | "bool"
  | "char"
  | "i8"
  | "u8"
  | "i16"
  | "u16"
  | "i32"
  | "u32"
  | "i64"
  | "u64"
  | "i128"
  | "u128"
  | "isize"
  | "usize"
  | "f16"
  | "f32"
  | "f64";

export interface RustTraitRef {
  readonly identity: RustSemanticIdentity;
  readonly displayPath: readonly string[];
  readonly arguments: readonly RustGenericArgument[];
  readonly associatedConstraints: readonly RustAssociatedConstraint[];
}

export interface RustConditionalTraitRequirement {
  readonly genericArgumentIndex: number;
  readonly bound: Extract<RustBound, { readonly kind: "trait" }>;
}

export interface RustTraitImplementationGenericBinding {
  readonly parameter: RustGenericArgument;
  readonly genericArgumentIndex: number;
}

export interface RustTraitImplementationEvidence {
  readonly trait: RustTraitRef;
  readonly genericBindings: readonly RustTraitImplementationGenericBinding[];
  readonly requirements: readonly RustConditionalTraitRequirement[];
}

export type RustAssociatedConstraint =
  | {
      readonly kind: "equality";
      readonly item: RustSemanticIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustGenericArgument[];
      readonly type: RustTypeRef;
    }
  | {
      readonly kind: "bounds";
      readonly item: RustSemanticIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustGenericArgument[];
      readonly bounds: readonly RustBound[];
    };

export type RustTypeRef =
  | { readonly kind: "source-primitive"; readonly name: SourcePrimitiveKind }
  | { readonly kind: "primitive"; readonly name: RustPrimitive }
  | { readonly kind: "never" }
  | { readonly kind: "unit" }
  | { readonly kind: "str" }
  | { readonly kind: "self"; readonly owner: RustSemanticIdentity }
  | {
      readonly kind: "type-parameter";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
    }
  | {
      readonly kind: "inference-variable";
      readonly identity: RustSemanticIdentity;
    }
  | { readonly kind: "tuple"; readonly elements: readonly RustTypeRef[] }
  | {
      readonly kind: "array";
      readonly element: RustTypeRef;
      readonly length: RustConstExpr;
    }
  | { readonly kind: "sequence"; readonly element: RustTypeRef }
  | { readonly kind: "slice"; readonly element: RustTypeRef }
  | {
      readonly kind: "path";
      readonly identity: RustSemanticIdentity;
      readonly displayPath: readonly string[];
      readonly arguments: readonly RustGenericArgument[];
    }
  | {
      readonly kind: "reference";
      readonly lifetime: RustLifetimeRef;
      readonly mutable: boolean;
      readonly target: RustTypeRef;
    }
  | {
      readonly kind: "raw-pointer";
      readonly mutable: boolean;
      readonly target: RustTypeRef;
    }
  | {
      readonly kind: "function-pointer";
      readonly binder?: RustBinder;
      readonly safety: "safe" | "unsafe";
      readonly abi: RustAbi;
      readonly parameters: readonly RustTypeRef[];
      readonly variadic: boolean;
      readonly result: RustTypeRef;
    }
  | {
      readonly kind: "closure";
      readonly binder?: RustBinder;
      readonly callTrait: "fn" | "fn-mut" | "fn-once";
      readonly parameters: readonly RustTypeRef[];
      readonly result: RustTypeRef;
      readonly captures: readonly RustCapturedGeneric[];
    }
  | {
      readonly kind: "trait-object";
      readonly principal: RustTraitRef;
      readonly autoTraits: readonly RustTraitRef[];
      readonly lifetime: RustLifetimeRef;
    }
  | {
      readonly kind: "opaque";
      readonly identity: RustSemanticIdentity;
      readonly bounds: readonly RustBound[];
      readonly captures: readonly RustCapturedGeneric[];
    }
  | {
      readonly kind: "associated-type";
      readonly owner: RustTypeRef;
      readonly trait: RustTraitRef;
      readonly item: RustSemanticIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustGenericArgument[];
    }
  | {
      readonly kind: "source-carrier";
      readonly identity: RustSemanticIdentity;
      readonly payload: Readonly<Record<string, unknown>>;
    };

export interface RustReceiver {
  readonly type: RustTypeRef;
  readonly explicit: boolean;
}
