import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export type RustDeferredProducerEffectsFact =
  | { readonly kind: "no-future" }
  | { readonly kind: "futures"; readonly errors: readonly TargetTypeRef[] };

export const rustDeferredProducerEffectsFactKey = defineRustPlanKey<RustDeferredProducerEffectsFact>(
  "deferredProducerEffects", closedMetadataEquals,
);
