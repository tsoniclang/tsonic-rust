import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";

export interface RustOptionEqualityEmission {
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "option-equality" }>;
  readonly left: Node;
  readonly right: Node;
  readonly leftRawOption: boolean;
  readonly rightRawOption: boolean;
  readonly leftOption: boolean;
  readonly rightOption: boolean;
}
