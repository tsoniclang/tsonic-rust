import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";

export interface RustGenericCallableEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
}

export interface RustGenericCallableInvocationFact {
  readonly carrier: TargetTypeRef;
  readonly ownerFileName: string;
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly awaiting: readonly RustNativeErrorSource<TargetTypeRef>[];
}

export const rustGenericCallableInvocationFactKey = defineRustPlanKey<RustGenericCallableInvocationFact>(
  "genericCallableInvocation", closedMetadataEquals);
