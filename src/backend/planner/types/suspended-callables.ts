import type { RustNativeCaptureEnvironmentStorage } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "./render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustSuspendedCallableStateType(
  environment: Extract<RustNativeCaptureEnvironmentStorage, { readonly kind: "suspended" }>, context: RustTypeRenderingContext,
): Extract<RustType, { kind: "named" }> {
  const selected = rustTypeFromSelectedNativeCarrierInContext(environment.stateCarrier, context);
  return selected.kind === "named" ? selected : failRustPlannerInvariant(
    "A sealed suspended environment requires its actual selected native named state.");
}
