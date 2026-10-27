import type { TargetTypeRef } from "../../types/model.js";

export interface RustDeferredProducerChannel {
  readonly awaiting: "fallible" | "infallible";
  readonly errorCarrier: TargetTypeRef;
}

export type RustDeferredProducerEffectsFact =
  | { readonly kind: "no-future" }
  | { readonly kind: "futures"; readonly channels: readonly RustDeferredProducerChannel[] };
