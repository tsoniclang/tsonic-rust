import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustErrorEffectsFact, RustNativeErrorEffect } from "../facts/error-effects.js";
import { mergeRustErrorEffects } from "../facts/error-effects.js";
import type { RustSourceErrorEffectEdge } from "../facts/source-error-effects.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

export function createRustSourceErrorEffectSelection(walk: RustFactWalk): (
  node: Node,
  declaration: Node,
  kind: RustSourceErrorEffectEdge["kind"],
  effects: RustErrorEffectsFact,
) => RustSourceErrorEffectEdge | undefined {
  const native = walk.context.callableValues.native;
  const inputs = new Map(native.inputs.map(input => [input.implementation.identity, input]));
  const origins = new Map<string, { readonly origin: RustNativeErrorEffect; readonly selected: RustNativeErrorEffect }>();
  for (const call of native.calls) {
    for (const source of [{ identity: call.invocationErrorSource, errorType: call.invocationError },
      ...call.awaitErrors.map((errorType, index) => ({ identity: call.awaitErrorSources[index]!, errorType }))]) {
      const selected = Object.freeze({ identity: source.identity, errorType: snapshotClosedMetadata(source.errorType) });
      origins.set(source.identity, { origin: selected, selected });
    }
  }
  return (node, declaration, kind, effects) => {
    if (effects.nativeErrors.length === 0) return Object.freeze({ declaration, kind, effects,
      nativeErrors: Object.freeze([]) });
    const signature = walk.context.facts.getSelectedTargetCall(node);
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey);
    const generics = rustTargetGenericBindingsForArguments(signature?.member.genericParameters ?? [],
      operation?.kind === "source-call" ? operation.targetGenericArguments ?? [] : []);
    if (generics === undefined) return undefined;
    const caller = sourceEnclosingCallable(node, walk.context.ast);
    const available = new Set(caller === undefined ? [] : [...native.inputsFor(caller), ...native.capturesFor(caller)]);
    const types = new Map(generics.types);
    const bindings = new Set<string>();
    for (const source of effects.nativeErrors) {
      const origin = origins.get(source.identity);
      if (origin === undefined || !rustTargetTypeRefEquals(origin.selected.errorType, source.errorType)) return undefined;
      for (const identity of rustTargetGenericReferences(source.errorType).typeIdentities) {
        const input = inputs.get(identity);
        if (input === undefined || bindings.has(identity)) continue;
        bindings.add(identity);
        if (input.owner !== declaration) {
          if (!available.has(input)) return undefined;
          continue;
        }
        const selected = walk.context.callableValues.nativeStorage.invocationInputFor(input, node, caller);
        if (selected.kind !== "selected" || selected.inputs.length !== 1) return undefined;
        types.set(identity, selected.inputs[0]!.implementation);
      }
    }
    const nativeErrors: RustSourceErrorEffectEdge["nativeErrors"][number][] = [];
    for (const source of effects.nativeErrors) {
      const origin = origins.get(source.identity)!.origin;
      const errorType = substituteRustTargetGenerics(source.errorType, types, generics.lifetimes, generics.consts);
      if (!isRustTargetTypeRef(errorType)) return undefined;
      const identity = rustTargetTypeRefEquals(errorType, source.errorType) ? source.identity
        : rustTargetTypeRefEquals(errorType, origin.errorType) ? origin.identity
          : `native-error-substitution:${closedMetadataKey({ source: origin.identity, errorType })}`;
      let target = origins.get(identity)?.selected;
      if (target === undefined) {
        target = Object.freeze({ identity, errorType: snapshotClosedMetadata(errorType) });
        origins.set(identity, { origin, selected: target });
      } else if (!rustTargetTypeRefEquals(target.errorType, errorType)) return undefined;
      nativeErrors.push(Object.freeze({ source, target }));
    }
    const selectedEffects = mergeRustErrorEffects([{ localErrors: effects.localErrors,
      nativeErrors: nativeErrors.map(entry => entry.target) }]);
    return selectedEffects === undefined ? undefined : Object.freeze({ declaration, kind, effects: selectedEffects,
      nativeErrors: Object.freeze(nativeErrors) });
  };
}
