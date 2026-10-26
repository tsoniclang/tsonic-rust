import type { RustTargetOperationFact } from "./operations.js";
import type { RustPhysicalErrorOwner } from "./error-regions.js";
import type { TargetTypeRef } from "../types/model.js";

export interface RustThrowCompletion {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "throw-op" }>;
  readonly owner: RustPhysicalErrorOwner;
}

export interface RustCatchBinding {
  readonly name: string;
  readonly used: boolean;
  readonly inputCarrier: TargetTypeRef;
  readonly readCarrier: TargetTypeRef;
  readonly conversionTarget: TargetTypeRef | undefined;
}
