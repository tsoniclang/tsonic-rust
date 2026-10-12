import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustNativeErrorEffect {
  readonly identity: string;
  readonly errorType: TargetTypeRef;
}

export interface RustErrorEffectsFact {
  readonly localErrors: boolean;
  readonly nativeErrors: readonly RustNativeErrorEffect[];
}

export const rustPureErrorEffects: RustErrorEffectsFact = Object.freeze({
  localErrors: false, nativeErrors: Object.freeze([]),
});

export const rustLocalErrorEffects: RustErrorEffectsFact = Object.freeze({
  localErrors: true, nativeErrors: Object.freeze([]),
});

export function rustErrorEffectsAreFallible(effects: RustErrorEffectsFact): boolean {
  return effects.localErrors || effects.nativeErrors.length !== 0;
}

export function rustErrorEffectsEqual(left: RustErrorEffectsFact, right: RustErrorEffectsFact): boolean {
  return left.localErrors === right.localErrors && left.nativeErrors.length === right.nativeErrors.length &&
    left.nativeErrors.every((source, index) => source.identity === right.nativeErrors[index]!.identity &&
      rustTargetTypeRefEquals(source.errorType, right.nativeErrors[index]!.errorType));
}

export function mergeRustErrorEffects(effects: readonly RustErrorEffectsFact[]): RustErrorEffectsFact | undefined {
  let localErrors = false;
  const nativeErrors = new Map<string, RustNativeErrorEffect>();
  for (const selected of effects) {
    localErrors ||= selected.localErrors;
    for (const source of selected.nativeErrors) {
      const previous = nativeErrors.get(source.identity);
      if (source.identity.length === 0 || !isRustTargetTypeRef(source.errorType) || previous !== undefined &&
        !rustTargetTypeRefEquals(previous.errorType, source.errorType)) return undefined;
      if (previous === undefined) nativeErrors.set(source.identity, Object.freeze({ ...source }));
    }
  }
  return nativeErrors.size === 0 ? localErrors ? rustLocalErrorEffects : rustPureErrorEffects
    : Object.freeze({ localErrors, nativeErrors: Object.freeze([...nativeErrors.values()]
      .sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)) });
}

export const rustErrorEffectsFactKey = defineRustPlanKey<RustErrorEffectsFact>("errorEffects", rustErrorEffectsEqual);
