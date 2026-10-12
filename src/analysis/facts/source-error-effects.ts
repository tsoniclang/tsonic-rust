import type { Node } from "@tsonic/tsts";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustErrorEffectsEqual, type RustErrorEffectsFact, type RustNativeErrorEffect } from "./error-effects.js";

export interface RustSourceErrorEffectEdge {
  readonly declaration: Node;
  readonly kind: "invoke" | "await";
  readonly effects: RustErrorEffectsFact;
  readonly nativeErrors: readonly {
    readonly source: RustNativeErrorEffect;
    readonly target: RustNativeErrorEffect;
  }[];
}

export interface RustSourceErrorEffectsFact {
  readonly edges: readonly RustSourceErrorEffectEdge[];
}

export function rustSourceErrorEffectEdgeEquals(edge: RustSourceErrorEffectEdge, other: RustSourceErrorEffectEdge): boolean {
  return edge.declaration === other.declaration && edge.kind === other.kind &&
      rustErrorEffectsEqual(edge.effects, other.effects) && edge.nativeErrors.length === other.nativeErrors.length &&
      edge.nativeErrors.every((entry, ordinal) => {
        const counterpart = other.nativeErrors[ordinal]!;
        return entry.source.identity === counterpart.source.identity && entry.target.identity === counterpart.target.identity &&
          rustTargetTypeRefEquals(entry.source.errorType, counterpart.source.errorType) &&
          rustTargetTypeRefEquals(entry.target.errorType, counterpart.target.errorType);
      });
}

export const rustSourceErrorEffectsFactKey = defineRustPlanKey<RustSourceErrorEffectsFact>("sourceErrorEffects",
  (left, right) => left.edges.length === right.edges.length &&
    left.edges.every((edge, index) => rustSourceErrorEffectEdgeEquals(edge, right.edges[index]!)));
