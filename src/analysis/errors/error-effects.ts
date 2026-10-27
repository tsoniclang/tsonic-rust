import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustErrorEffectsFact, RustNativeErrorEffect } from "../../target-model/records/error-effects.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import type { Node } from "@tsonic/tsts";
import type { RustPromiseBodies } from "../../target-model/records/callables-and-resources.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { selectRustProducerError, type RustProducerErrorContext } from "../callables/calls/producer-errors.js";

export const rustPureErrorEffects: RustErrorEffectsFact = Object.freeze({
  localErrors: false, nativeErrors: Object.freeze([]),
});

export const rustLocalErrorEffects: RustErrorEffectsFact = Object.freeze({
  localErrors: true, nativeErrors: Object.freeze([]),
});

export function rustCallableInvocationErrorEffects(error: TargetTypeRef): RustErrorEffectsFact {
  if (rustUninhabitedError(error)) return rustPureErrorEffects;
  const owner = rustProgramErrorOwner(error);
  if (owner?.kind === "logical" || owner?.kind === "physical" && owner.domain === "runtime")
    return rustLocalErrorEffects;
  const identity = rustTargetTypeRefEquals(error, rustJsValueTargetType())
    ? rustJsRejectionErrorIdentity : `runtime-callable-error:${closedMetadataKey(error)}`;
  return Object.freeze({ localErrors: false,
    nativeErrors: Object.freeze([Object.freeze({ identity, errorType: error })]),
  });
}

export function rustErrorEffectsAreFallible(effects: RustErrorEffectsFact): boolean {
  return effects.localErrors || effects.nativeErrors.length !== 0;
}

export function rustProducerInvocationErrorEffects(
  declaration: Node,
  input: RustProducerErrorContext & {
    readonly promiseBodies: Pick<RustPromiseBodies, "objects" | "declarations">;
  },
): RustErrorEffectsFact | undefined {
  const producer = input.producers.forDeclaration(declaration);
  const invocation = producer === undefined ? undefined : selectRustProducerError({ identity: producer.identity,
    fileName: producer.fileName, channel: "invoke", genericArguments: producer.environment }, input);
  if (invocation === undefined) return undefined;
  if (invocation.kind === "carrier") return rustCallableInvocationErrorEffects(invocation.carrier);
  const operation = input.records.targetOperation.get(declaration);
  const callback = operation?.kind === "closure" ? rustCallableProtocol(operation.resultCarrier) : undefined;
  return !input.promiseBodies.declarations.has(declaration) && (input.promiseBodies.objects.has(declaration) ||
    rustTargetTypeRefEquals(callback?.error, rustJsValueTargetType()))
    ? rustCallableInvocationErrorEffects(rustJsValueTargetType()) : invocation.effects;
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
      if (previous === undefined) nativeErrors.set(source.identity, Object.freeze({ identity: source.identity,
        errorType: snapshotClosedMetadata(source.errorType) }));
    }
  }
  return nativeErrors.size === 0 ? localErrors ? rustLocalErrorEffects : rustPureErrorEffects
    : Object.freeze({ localErrors, nativeErrors: Object.freeze([...nativeErrors.values()]
      .sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0)) });
}
