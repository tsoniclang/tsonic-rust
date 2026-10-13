import { defineRustPlanKey } from "../key.js";
import type { RustErrorEffectsFact } from "../../../../target-model/records/error-effects.js";
import { rustErrorEffectsEqual } from "../../../errors/error-effects.js";

export const rustErrorEffectsFactKey = defineRustPlanKey<RustErrorEffectsFact>("errorEffects", rustErrorEffectsEqual);
