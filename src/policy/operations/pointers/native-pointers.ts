import { selectTargetNativePointerOperation } from "@tsonic/target-api/analysis";
import type { RustRawLocationPlan } from "../../../target-model/records/native/native-memory.js";
import type { RustRawAddressPlan } from "../../../target-model/records/storage/raw-addresses.js";
import type { RustNativePointerOperationSelection } from "../../../target-model/records/native/native-pointers.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustMemoryLayoutObservationFact } from "../../../target-model/records/analysis.js";

export function selectRustNativePointerOperation(
  rawLocation: RustRawLocationPlan | undefined,
  layout: RustMemoryLayoutObservationFact | undefined,
  rawAddress: RustRawAddressPlan | undefined,
  operation: RustTargetOperationFact | undefined,
): RustNativePointerOperationSelection | undefined {
  const identity = rawAddress?.method === "same" || rawAddress?.method === "hash";
  return selectTargetNativePointerOperation(
    rawLocation === undefined ? undefined : Object.freeze({ kind: "raw-location" as const, plan: rawLocation }),
    layout === undefined ? undefined : Object.freeze({ kind: "layout-query" as const, observation: layout }),
    rawAddress === undefined || identity ? undefined : Object.freeze({ kind: "raw-address" as const, plan: rawAddress }),
    rawAddress === undefined || !identity ? undefined : Object.freeze({ kind: "raw-identity" as const, plan: rawAddress }),
    operation?.kind !== "native-pointer" ? undefined : Object.freeze({ kind: "native-pointer" as const, operation }));
}
