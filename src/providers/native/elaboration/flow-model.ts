import type { RustNativeDefinitionId, RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";

export interface RustNativeBodyFlow {
  readonly owner: RustNativeDefinitionId;
  readonly argumentCount: number;
  readonly locals: readonly RustNativeFlowLocal[];
  readonly blocks: readonly RustNativeFlowBlock[];
}

export interface RustNativeFlowOrigin {
  readonly node: RustNativeNodeId;
  readonly source: RustNativeSourceSpan | null;
}

export interface RustNativeFlowLocal {
  readonly origin: RustNativeFlowOrigin;
  readonly binding: RustNativeNodeId | null;
  readonly guardTarget: number | null;
}

export interface RustNativeFlowBlock {
  readonly cleanup: boolean;
  readonly statements: readonly RustNativeFlowStep[];
  readonly terminator: RustNativeFlowStep & { readonly control: RustNativeFlowControl };
}

export interface RustNativeFlowStep {
  readonly origin: RustNativeFlowOrigin;
  readonly accesses: readonly RustNativeFlowAccess[];
}

export interface RustNativeFlowAccess {
  readonly kind: "inspect" | "copy" | "move" | "borrow-shared" | "borrow-fake" | "address-shared" |
    "place-mention" | "projection-read" | "store" | "set-discriminant" | "assembly-output" | "call-result" |
    "yield-result" | "drop" | "borrow-mutable" | "address-mutable" | "projection-write" | "retag" |
    "storage-live" | "storage-dead" | "ascribe-type" | "debug-info" | "drop-hint";
  readonly local: number;
  readonly projections: readonly RustNativeFlowProjection[];
}

export type RustNativeFlowProjection =
  | { readonly kind: "dereference" | "opaque-cast" | "unwrap-unsafe-binder" }
  | { readonly kind: "field"; readonly field: number }
  | { readonly kind: "index"; readonly local: number }
  | { readonly kind: "constant-index"; readonly offset: string; readonly minimumLength: string; readonly fromEnd: boolean }
  | { readonly kind: "subslice"; readonly from: string; readonly to: string; readonly fromEnd: boolean }
  | { readonly kind: "downcast"; readonly variant: number };

export type RustNativeFlowControl =
  | { readonly kind: "goto"; readonly target: number }
  | { readonly kind: "switch"; readonly branches: readonly { readonly value: string; readonly target: number }[];
      readonly otherwise: number }
  | { readonly kind: "return" | "unreachable" | "unwind-resume" | "tail-call" | "coroutine-drop" }
  | { readonly kind: "unwind-terminate"; readonly reason: RustNativeUnwindReason }
  | { readonly kind: "drop"; readonly target: number; readonly unwind: RustNativeUnwind; readonly drop: number | null }
  | { readonly kind: "call"; readonly target: number | null; readonly unwind: RustNativeUnwind }
  | { readonly kind: "assert"; readonly target: number; readonly unwind: RustNativeUnwind }
  | { readonly kind: "yield"; readonly resume: number; readonly drop: number | null }
  | { readonly kind: "false-edge"; readonly real: number; readonly imaginary: number }
  | { readonly kind: "false-unwind"; readonly real: number; readonly unwind: RustNativeUnwind }
  | { readonly kind: "inline-assembly"; readonly targets: readonly number[]; readonly unwind: RustNativeUnwind };

export type RustNativeUnwindReason = "abi" | "in-cleanup";

export type RustNativeUnwind =
  | { readonly kind: "continue" | "unreachable" }
  | { readonly kind: "terminate"; readonly reason: RustNativeUnwindReason }
  | { readonly kind: "cleanup"; readonly target: number };
