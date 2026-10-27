import type { RustRawLocationPlan } from "./native-memory.js";
import type { RustRawAddressPlan } from "../storage/raw-addresses.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustNativePointerOperationSelection =
  | { readonly kind: "raw-location"; readonly plan: RustRawLocationPlan }
  | { readonly kind: "layout-query"; readonly observation: { readonly value: bigint } }
  | { readonly kind: "raw-address"; readonly plan: RustRawAddressPlan }
  | { readonly kind: "raw-identity"; readonly plan: RustRawAddressPlan }
  | { readonly kind: "native-pointer"; readonly operation: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }> };
