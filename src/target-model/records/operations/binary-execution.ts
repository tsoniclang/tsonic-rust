import type { RustFallibleErrorBoundary } from "../../operations/error-boundary.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustDispatchContextGroupInput } from "../../operations/dispatch-contexts.js";
import type { RustBinaryHookPhase } from "../../operations/binary-hooks.js";

interface RustBinaryHookPlanBase {
  readonly id: string;
  readonly phase: RustBinaryHookPhase;
  readonly path: string;
  readonly dispatchGroups: readonly RustDispatchContextGroupInput[];
}

export type RustBinaryHookPlan = RustBinaryHookPlanBase & (
  | { readonly isFallible: true; readonly errorBoundary: "provider-native"; readonly errorCarrier: TargetTypeRef }
  | { readonly isFallible: true; readonly errorBoundary: Exclude<RustFallibleErrorBoundary, "provider-native">; readonly errorCarrier?: never }
  | { readonly isFallible: false; readonly errorBoundary?: never; readonly errorCarrier?: never }
);

export type RustBinaryExecution =
  | { readonly kind: "library" }
  | { readonly kind: "native"; readonly executor: RustBinaryHookPlan | undefined }
  | { readonly kind: "owned"; readonly execution: "entry" | "future"; readonly owner: RustBinaryHookPlan };
