import type { RustTargetOperationFact } from "./operations.js";

export type RustProjectFieldSelection = Omit<
  Extract<RustTargetOperationFact, { readonly kind: "source-field" }>, "operationId" | "accessMode"
>;
