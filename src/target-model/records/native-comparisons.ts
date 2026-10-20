import type { RustRecordFamily } from "./program.js";
import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "./finalized-operation.js";

export type RustNativeComparison =
  | { readonly kind: "ordinary" }
  | { readonly kind: "integer-identity"; readonly operand: "left" | "right" }
  | { readonly kind: "unsigned-constant"; readonly operand: "left" | "right"; readonly value: boolean; readonly evaluate: boolean }
  | { readonly kind: "unsigned-zero"; readonly operand: "left" | "right"; readonly operator: "==" | "!=";
      readonly empty: { readonly receiver: Node; readonly input: RustFinalizedSourceInput; readonly method: string } | undefined };

export interface RustNativeComparisonRecords {
  readonly nativeComparison: RustRecordFamily<RustNativeComparison>;
}
