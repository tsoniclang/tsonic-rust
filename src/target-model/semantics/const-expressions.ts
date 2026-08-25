import type { RustSemanticIdentity } from "./identity.js";

export type RustConstUnaryOperator = "negate" | "not";

export type RustConstBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "remainder"
  | "shift-left"
  | "shift-right"
  | "bit-and"
  | "bit-or"
  | "bit-xor";

export type RustConstExpr =
  | { readonly kind: "literal"; readonly literalKind: "boolean"; readonly value: boolean }
  | { readonly kind: "literal"; readonly literalKind: "integer"; readonly value: bigint }
  | { readonly kind: "literal"; readonly literalKind: "character"; readonly value: string }
  | { readonly kind: "parameter"; readonly identity: RustSemanticIdentity; readonly displayName: string }
  | { readonly kind: "item"; readonly identity: RustSemanticIdentity; readonly displayPath: readonly string[] }
  | {
      readonly kind: "unary";
      readonly operator: RustConstUnaryOperator;
      readonly operand: RustConstExpr;
    }
  | {
      readonly kind: "binary";
      readonly operator: RustConstBinaryOperator;
      readonly left: RustConstExpr;
      readonly right: RustConstExpr;
    }
  | { readonly kind: "inferred" };
