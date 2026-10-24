import type { Node } from "@tsonic/tsts";

export type RustStringComparisonView =
  | { readonly kind: "value" }
  | { readonly kind: "native-str-reference"; readonly inputForm: "shared-reference" | "value" }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "error" }
  | { readonly kind: "source"; readonly operand: Node }
  | { readonly kind: "contextual" };
