import type { TargetTypeRef } from "../types/model.js";
import type { RustNativeErrorSource } from "../types/native-error-joins.js";

export interface RustGenericCallableEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
}

export interface RustGenericCallableInvocationFact<Source extends RustNativeErrorSource<TargetTypeRef> = RustNativeErrorSource<TargetTypeRef>> {
  readonly carrier: TargetTypeRef;
  readonly ownerFileName: string;
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly Source[];
  readonly awaiting: readonly Source[];
}
