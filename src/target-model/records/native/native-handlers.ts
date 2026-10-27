import type { TargetNativeHandler } from "@tsonic/target-api/analysis";
import type { RustMemoryBindingPlan } from "../storage/memory-bindings.js";
import type { RustSafetyOperation } from "../storage/safety.js";
import type { RustNativePointerOperationSelection } from "./native-pointers.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { RustTypedLocationPlan } from "../operations/typed-location-plans.js";

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
