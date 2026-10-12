import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceErrorEffectEdgeEquals, type RustSourceErrorEffectEdge } from "./source-error-effects.js";

export interface RustAwaitSourceErrorBranch {
  readonly carrier: TargetTypeRef;
  readonly edge: RustSourceErrorEffectEdge;
}

export interface RustAwaitSourceErrorEffectsFact {
  readonly branches: readonly RustAwaitSourceErrorBranch[];
}

export const rustAwaitSourceErrorEffectsFactKey = defineRustPlanKey<RustAwaitSourceErrorEffectsFact>(
  "awaitSourceErrorEffects", (left, right) => left.branches.length === right.branches.length &&
    left.branches.every((branch, index) => rustTargetTypeRefEquals(branch.carrier, right.branches[index]!.carrier) &&
      rustSourceErrorEffectEdgeEquals(branch.edge, right.branches[index]!.edge)),
);
