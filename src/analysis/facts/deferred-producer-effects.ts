import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustDeferredProducerChannel {
  readonly awaiting: "fallible" | "infallible";
  readonly errorCarrier: TargetTypeRef;
}

export type RustDeferredProducerEffectsFact =
  | { readonly kind: "no-future" }
  | { readonly kind: "futures"; readonly channels: readonly RustDeferredProducerChannel[] };

export function mergeRustDeferredProducerChannels(
  channels: readonly RustDeferredProducerChannel[],
): RustDeferredProducerChannel | undefined {
  const selected = channels[0];
  return selected !== undefined && channels.every(channel => closedMetadataEquals(selected, channel)) ? selected : undefined;
}

export const rustDeferredProducerEffectsFactKey = defineRustPlanKey<RustDeferredProducerEffectsFact>(
  "deferredProducerEffects", closedMetadataEquals,
);
