import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustErrorEffectsEqual } from "./error-effects.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";

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
