import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustValueReadOwnership } from "../storage/ownership.js";

export interface RustOptionEqualityEmission {
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "option-equality" }>;
  readonly left: Node;
  readonly right: Node;
  readonly leftRawOption: boolean;
  readonly rightRawOption: boolean;
  readonly leftOption: boolean;
  readonly rightOption: boolean;
  readonly precedingAcquisition: Exclude<RustValueReadOwnership, { readonly kind: "borrow" }> | undefined;
}
