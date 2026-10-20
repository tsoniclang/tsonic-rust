import type { TargetTypeRef } from "./model.js";

export type RustTypeofResult =
  | "boolean" | "number" | "bigint" | "string" | "symbol" | "function" | "object" | "undefined"
  | { readonly kind: "runtime-method"; readonly method: string; readonly sourceCarrier: TargetTypeRef }
  | { readonly kind: "optional"; readonly sourceCarrier: TargetTypeRef; readonly value: RustTypeofResult }
  | { readonly kind: "source-union"; readonly sourceCarrier: TargetTypeRef;
      readonly variants: readonly { readonly name: string; readonly carrier: TargetTypeRef; readonly result: RustTypeofResult }[] };
