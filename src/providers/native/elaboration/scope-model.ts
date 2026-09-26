import type { RustNativeDefinitionId, RustNativeSourceSpan } from "./evidence.js";
import type { RustNativeArgument } from "./type-model.js";

export type RustNativeVisibility =
  | { readonly kind: "public" }
  | { readonly kind: "restricted"; readonly module: RustNativeDefinitionId };

export type RustNativeBindingResolution =
  | { readonly kind: "declaration" | "self-parameter" | "self-constructor"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "self-alias"; readonly definition: RustNativeDefinitionId; readonly traitImplementation: boolean }
  | { readonly kind: "primitive" | "open-module" | "builtin-attribute"; readonly name: string }
  | { readonly kind: "tool-module" | "tool-attribute" | "derive-helper" | "forward-derive-helper" };

export type RustNativeReexport =
  | { readonly kind: "single" | "glob" | "extern-crate"; readonly definition: RustNativeDefinitionId }
  | { readonly kind: "macro-use" | "macro-export" };

export interface RustNativeBinding {
  readonly name: string;
  readonly namespace: "type" | "value" | "macro";
  readonly source: RustNativeSourceSpan | null;
  readonly visibility: RustNativeVisibility;
  readonly resolution: RustNativeBindingResolution;
  readonly reexports: readonly RustNativeReexport[];
}

export type RustNativeScope =
  | {
    readonly kind: "named";
    readonly owner: RustNativeDefinitionId;
    readonly bindings: readonly RustNativeBinding[];
    readonly ambiguities: readonly { readonly main: RustNativeBinding; readonly second: RustNativeBinding }[];
  }
  | {
    readonly kind: "implementation";
    readonly owner: RustNativeDefinitionId;
    readonly selfType: number;
    readonly trait: {
      readonly definition: RustNativeDefinitionId;
      readonly arguments: readonly RustNativeArgument[];
      readonly polarity: "positive" | "negative" | "reservation";
      readonly safety: "safe" | "unsafe";
      readonly constness: "comptime" | "const" | "ordinary";
    } | null;
    readonly members: readonly {
      readonly definition: RustNativeDefinitionId;
      readonly traitMember: RustNativeDefinitionId | null;
    }[];
  };
