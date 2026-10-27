import type { RustRecordFamily } from "../program.js";
import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustNativeComparison =
  | { readonly kind: "ordinary" }
  | { readonly kind: "scoped-string";
      readonly source: { readonly kind: "field"; readonly field: Node }
        | { readonly kind: "provider"; readonly node: Node;
            readonly operation: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;
            readonly receiver: Node; readonly arguments: readonly Node[] };
      readonly value: string; readonly reversed: boolean; readonly operator: "==" | "!=" }
  | { readonly kind: "integer-identity"; readonly operand: "left" | "right" }
  | { readonly kind: "unsigned-constant"; readonly operand: "left" | "right"; readonly value: boolean; readonly evaluate: boolean }
  | { readonly kind: "unsigned-zero"; readonly operand: "left" | "right"; readonly operator: "==" | "!=";
      readonly empty: { readonly receiver: Node; readonly input: RustFinalizedSourceInput; readonly method: string } | undefined }
  | { readonly kind: "integer-constant"; readonly value: boolean }
  | { readonly kind: "boolean" | "empty-string"; readonly operand: "left" | "right"; readonly negated: boolean }
  | { readonly kind: "range"; readonly subject: Node; readonly lower: Node; readonly upper: Node;
      readonly operator: "&&" | "||"; readonly form: "contains" | "outside-float";
      readonly prefix: Node | undefined; readonly suffix: Node | undefined };

export interface RustNativeComparisonRecords {
  readonly nativeComparison: RustRecordFamily<RustNativeComparison>;
}
