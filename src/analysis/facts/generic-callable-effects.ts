import { defineRustPlanKey } from "../../target-model/facts/keys.js";

export interface RustGenericCallableEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
}

export const rustGenericCallableEffectsFactKey = defineRustPlanKey<RustGenericCallableEffectsFact>(
  "genericCallableEffects", (left, right) => left.invocation === right.invocation && left.awaiting === right.awaiting,
);
