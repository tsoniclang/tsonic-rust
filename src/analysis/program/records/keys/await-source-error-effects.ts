import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustSourceErrorEffectEdgeEquals } from "../../../errors/source-error-effects.js";
import type { RustAwaitSourceErrorEffectsFact } from "../../../../target-model/records/await-source-error-effects.js";

export const rustAwaitSourceErrorEffectsFactKey = defineRustPlanKey<RustAwaitSourceErrorEffectsFact>(
  "awaitSourceErrorEffects", (left, right) => left.branches.length === right.branches.length &&
    left.branches.every((branch, index) => rustTargetTypeRefEquals(branch.carrier, right.branches[index]!.carrier) &&
      rustSourceErrorEffectEdgeEquals(branch.edge, right.branches[index]!.edge)),
);
