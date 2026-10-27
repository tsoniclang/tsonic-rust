import type { RustClosedNativeProjectionPolicyInput } from "../../model/closed-native-values.js";
import type { RustClosedNativeProjectionEmission } from "../../../target-model/records/objects/object-projections.js";

export function selectRustClosedNativeProjection(input: RustClosedNativeProjectionPolicyInput): RustClosedNativeProjectionEmission {
  return Object.freeze({ carrier: input.target, representation: input.representation,
    payload: input.representation.kind === "value" ? "value" : input.representation.kind === "open-hierarchy" ? "dispatch" : "state",
    query: input.programError && input.domain === "runtime" ? "none" : input.representation.kind === "value" ? "native_value" : "native_shared",
    optional: input.optional });
}
