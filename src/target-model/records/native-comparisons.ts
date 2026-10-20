import type { RustRecordFamily } from "./program.js";

export type RustNativeComparison =
  | { readonly kind: "ordinary" }
  | { readonly kind: "integer-identity"; readonly operand: "left" | "right" };

export interface RustNativeComparisonRecords {
  readonly nativeComparison: RustRecordFamily<RustNativeComparison>;
}
