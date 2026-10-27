import type { TargetNativeHandler } from "@tsonic/target-api/analysis";
import type { RustMemoryBindingPlan } from "../storage/memory-bindings.js";
import type { RustSafetyOperation } from "../storage/safety.js";
import type { RustNativePointerOperationSelection } from "./native-pointers.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../operations/operations.js";

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
