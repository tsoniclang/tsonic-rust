import { selectTargetNativeHandler } from "@tsonic/target-api/analysis";
import type { SourceMarkerFact } from "@tsonic/tsts";
import type { RustMemoryBindingPlan } from "../../../target-model/records/storage/memory-bindings.js";
import type { RustNativeHandler } from "../../../target-model/records/native/native-handlers.js";
import type { RustNativePointerOperationSelection } from "../../../target-model/records/native/native-pointers.js";
import type { RustSafetyOperation } from "../../../target-model/records/storage/safety.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../../target-model/records/operations/operations.js";

export function selectRustNativeHandler(
  memoryBinding: RustMemoryBindingPlan | undefined,
  safety: RustSafetyOperation | undefined,
  marker: SourceMarkerFact | undefined,
  operation: RustTargetOperationFact | undefined,
  nativePointer: RustNativePointerOperationSelection | undefined,
  typedLocation: RustTypedLocationPlan | undefined,
): RustNativeHandler | undefined {
  return selectTargetNativeHandler(memoryBinding, safety,
    marker?.kind === "call-marker" && marker.marker === "js-string" && operation?.kind === "provider-operation" ? operation : undefined,
    nativePointer,
    operation?.kind === "typed-location" && typedLocation !== undefined
      ? Object.freeze({ operation, plan: typedLocation }) : undefined);
}
