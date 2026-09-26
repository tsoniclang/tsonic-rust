import type { RustNativeDefinitionId, RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import type { RustNativeArgument } from "./type-model.js";

export type RustNativeResolution =
  | { readonly kind: "declaration"; readonly id: RustNativeDefinitionId }
  | { readonly kind: "binding"; readonly id: RustNativeNodeId };

interface RustNativeOccurrenceBase {
  readonly id: RustNativeNodeId;
  readonly source: RustNativeSourceSpan | null;
  readonly type: number;
  readonly resolution: RustNativeResolution | null;
}

export type RustNativeOccurrence = RustNativeOccurrenceBase & (
  | { readonly kind: "expression"; readonly adjustedType: number;
      readonly arguments: readonly RustNativeArgument[] | null;
      readonly adjustments: readonly RustNativeAdjustment[] }
  | { readonly kind: "pattern"; readonly adjustments: readonly RustNativePatternAdjustment[];
      readonly binding: RustNativeBindingMode | null }
);

export interface RustNativeAdjustment {
  readonly target: number;
  readonly operation:
    | { readonly kind: "never-to-any" | "builtin-deref" | "pin-deref" | "unsafe-function-pointer" |
        "mutable-to-const-pointer" | "array-to-pointer" | "unsize" }
    | { readonly kind: "overloaded-deref"; readonly mutable: boolean; readonly method: RustNativeDefinitionId }
    | { readonly kind: "borrow-reference"; readonly mutable: boolean; readonly twoPhase: boolean }
    | { readonly kind: "borrow-raw-pointer" | "borrow-pin" | "generic-reborrow"; readonly mutable: boolean }
    | { readonly kind: "reify-function-pointer" | "closure-function-pointer"; readonly unsafe: boolean };
}

export interface RustNativePatternAdjustment {
  readonly source: number;
  readonly kind: "builtin-deref" | "overloaded-deref" | "pin-deref";
}

export interface RustNativeBindingMode {
  readonly mutable: boolean;
  readonly reference: { readonly mutable: boolean; readonly pinned: boolean } | null;
}
