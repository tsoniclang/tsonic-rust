import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../operations/operations.js";

export interface RustFieldProjectionAssignment {
  readonly expression: Node;
  readonly receiver: Node;
  readonly field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>;
}
