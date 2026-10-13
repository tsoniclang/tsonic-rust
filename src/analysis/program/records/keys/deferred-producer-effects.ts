import { defineRustPlanKey } from "../key.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustDeferredProducerEffectsFact } from "../../../../target-model/records/deferred-producer-effects.js";

export const rustDeferredProducerEffectsFactKey = defineRustPlanKey<RustDeferredProducerEffectsFact>(
  "deferredProducerEffects", closedMetadataEquals,
);
