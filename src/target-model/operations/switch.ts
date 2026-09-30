import type { RustBinaryOperatorSelection } from "./binary.js";

export type RustSwitchComparison =
  | { readonly kind: "constant"; readonly value: boolean }
  | { readonly kind: "absence"; readonly operand: "left" | "right" }
  | {
      readonly kind: "native";
      readonly leftOptional: boolean;
      readonly rightOptional: boolean;
      readonly operation: Exclude<RustBinaryOperatorSelection, { readonly kind: "string-concat" }>;
    };
