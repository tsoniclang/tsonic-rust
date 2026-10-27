import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";

export type RustExpressionSyntax =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "char"; readonly value: number }
  | { readonly kind: "absence"; readonly carrier: TargetTypeRef }
  | { readonly kind: "non-null"; readonly operation: "identity" | "unwrap" | "custom"; readonly source: TargetTypeRef }
  | { readonly kind: "yield"; readonly declaration: Node; readonly method: "yield_value" | "yield_from" | "yield_from_async"; readonly operand: Node | undefined;
      readonly delegated: { readonly next: TargetTypeRef; readonly result: TargetTypeRef } | undefined };

export interface RustExpressionSyntaxRecords {
  readonly expressionSyntax: RustRecordFamily<RustExpressionSyntax>;
}
