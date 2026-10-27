import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";

export interface RustNullishCoalescingEmission {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "option-coalesce" }>;
  readonly left: Node;
  readonly right: Node;
  readonly leftCarrier: TargetTypeRef;
}
