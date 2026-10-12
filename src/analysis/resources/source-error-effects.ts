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
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeCallableProducer } from "../callables/native-producers.js";
import { rustNativeCallableErrorType } from "../callables/native-protocols.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";

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
    const producers = new Map<string, RustNativeCallableProducer>();
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
        const selected = walk.context.callableValues.nativeStorage.invocationOriginsFor(input, node, caller);
        if (selected.kind !== "resolved") return undefined;
        let actual: TargetTypeRef | undefined;
        let producer: RustNativeCallableProducer | undefined;
        for (const subject of selected.subjects) {
          const parameter = native.inputs.find(candidate => candidate.subject === subject);
          if (parameter !== undefined) {
            if (producer !== undefined || actual !== undefined && !rustTargetTypeRefEquals(actual, parameter.implementation)) return undefined;
            actual = parameter.implementation;
          } else {
            if (rustOptionElementCarrier(input.carrier) !== undefined && subject.projection.length === 0 &&
              isRustAbsenceCarrier(walk.context.facts.getRuntimeCarrierFact(subject.node)?.carrier)) continue;
            const candidate = subject.projection.length === 0
              ? walk.context.callableValues.nativeProducers.forDeclaration(subject.node) : undefined;
            if (candidate === undefined || actual !== undefined || producer !== undefined && candidate !== producer) return undefined;
            producer = candidate;
          }
        }
        if (actual !== undefined) types.set(identity, actual);
        else if (producer !== undefined) producers.set(identity, producer);
        else return undefined;
      }
    }
    const nativeErrors: RustSourceErrorEffectEdge["nativeErrors"][number][] = [];
    for (const source of effects.nativeErrors) {
      const origin = origins.get(source.identity)!.origin;
      let valid = true;
      const errorType = substituteRustTargetGenerics(source.errorType, types, generics.lifetimes, generics.consts, (type, original) => {
        if (original.kind !== "associated-type" || original.owner.kind !== "type-parameter") return type;
        const producer = producers.get(original.owner.identity);
        const input = inputs.get(original.owner.identity);
        if (producer === undefined || input === undefined) return type;
        const sourceItem = original.trait?.sourceItem;
        const protocol = sourceItem === undefined ? undefined : native.protocolForSourceItem(sourceItem.fileName, sourceItem.typeName);
        if (protocol === undefined) { valid = false; return type; }
        const channels = ["invocation" as const, ...(protocol.completion?.futures.map(future => future.ordinal) ?? [])];
        const channel = channels.find(channel => {
          const expected = rustNativeCallableErrorType(protocol, original.owner, channel, original.genericArguments ?? []);
          return expected !== undefined && rustTargetTypeRefEquals(expected, original);
        });
        const replacement = channel === undefined ? undefined : walk.context.callableValues.nativeProducers.errorFor(
          producer.declaration, channel === "invocation" ? "invoke" : channel);
        if (replacement === undefined) { valid = false; return type; }
        return substituteRustTargetGenerics(replacement, types, generics.lifetimes, generics.consts);
      });
      if (!valid) return undefined;
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
