import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustProjectAccessorSelection = Omit<Extract<RustTargetOperationFact,
  { readonly kind: "source-accessor" }>, "operationId" | "accessMode">;
