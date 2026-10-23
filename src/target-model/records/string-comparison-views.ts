import type { Node } from "@tsonic/tsts";

export type RustStringComparisonView =
  | { readonly kind: "value" }
  | { readonly kind: "owned-string" }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "error" }
  | { readonly kind: "source"; readonly operand: Node }
  | { readonly kind: "contextual" };
