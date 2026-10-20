import type { RustTargetOperationFact } from "./operations.js";

export interface RustReferenceOperationEmission {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "reference-operation" }>;
  readonly load: "reference" | "owned-string" | "dereference";
}
