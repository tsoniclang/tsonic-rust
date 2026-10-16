import type { TargetNativeHandler } from "@tsonic/target-api/analysis";
import type { RustMemoryBindingPlan } from "./memory-bindings.js";
import type { RustSafetyOperation } from "./safety.js";
import type { RustNativePointerOperationSelection } from "./native-pointers.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "./operations.js";

export interface RustSelectedNativeCall {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "typed-location" }>;
  readonly plan: RustTypedLocationPlan;
}

export type RustNativeHandler = TargetNativeHandler<
  RustMemoryBindingPlan,
  RustSafetyOperation,
  Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  RustNativePointerOperationSelection,
  RustSelectedNativeCall
>;
