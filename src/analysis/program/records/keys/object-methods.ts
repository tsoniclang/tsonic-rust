import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import type { RustSourceCallEffectsFact, RustSourceAccessorEffectsFact, RustFutureValueFact } from "../../../../target-model/records/object-methods.js";

export const rustFallibleFactKey: RustPlanKey<{ readonly fallible: true }> =
  defineRustPlanKey("fallible", () => true);

export const rustSourceCallEffectsFactKey: RustPlanKey<RustSourceCallEffectsFact> =
  defineRustPlanKey("sourceCallEffects", closedMetadataEquals);

export const rustSourceAccessorEffectsFactKey: RustPlanKey<RustSourceAccessorEffectsFact> =
  defineRustPlanKey("sourceAccessorEffects", closedMetadataEquals);

export const rustFutureValueFactKey: RustPlanKey<RustFutureValueFact> =
  defineRustPlanKey("futureValue", closedMetadataEquals);
