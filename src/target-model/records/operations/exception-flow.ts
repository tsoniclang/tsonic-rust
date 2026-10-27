import type { RustTargetOperationFact } from "./operations.js";
import type { RustPhysicalErrorOwner } from "../errors/error-regions.js";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustThrowCompletion {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "throw-op" }>;
  readonly owner: RustPhysicalErrorOwner;
}

export interface RustCatchBinding {
  readonly name: string;
  readonly used: boolean;
  readonly inputCarrier: TargetTypeRef;
  readonly readCarrier: TargetTypeRef;
  readonly conversion: { readonly target: TargetTypeRef; readonly operand: RustCatchErrorConversion } | undefined;
}

export type RustCatchErrorConversion =
  | { readonly kind: "identity" | "into" | "uninhabited"; readonly carrier: TargetTypeRef }
  | { readonly kind: "native-join"; readonly carrier: TargetTypeRef; readonly arms: readonly RustCatchErrorConversion[] };
