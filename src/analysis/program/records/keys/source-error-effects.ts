import { defineRustPlanKey } from "../key.js";
import type { RustSourceErrorEffectsFact } from "../../../../target-model/records/source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals } from "../../../errors/source-error-effects.js";

export const rustSourceErrorEffectsFactKey = defineRustPlanKey<RustSourceErrorEffectsFact>("sourceErrorEffects",
  (left, right) => left.edges.length === right.edges.length &&
    left.edges.every((edge, index) => rustSourceErrorEffectEdgeEquals(edge, right.edges[index]!)));
