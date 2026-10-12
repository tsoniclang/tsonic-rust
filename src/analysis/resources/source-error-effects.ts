import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustErrorEffectsFact, RustNativeErrorEffect } from "../facts/error-effects.js";
import { mergeRustErrorEffects } from "../facts/error-effects.js";
import type { RustSourceErrorEffectEdge } from "../facts/source-error-effects.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics, substituteRustTargetGenericArgument } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeCallableProducer } from "../callables/native-producers.js";
import { rustNativeCallableErrorType } from "../callables/native-protocols.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import type { SourceStorageBindings } from "@tsonic/target-api/analysis";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import type { RustTargetConstArgument } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";

export interface RustSourceErrorBindings extends RustTargetGenericBindings {
  substitute(carrier: TargetTypeRef): TargetTypeRef | undefined;
}

export interface RustSourceErrorEffectSelection {
  register(errors: readonly RustNativeErrorEffect[]): boolean;
  bindingsFor(node: Node, declaration: Node, carriers: readonly TargetTypeRef[],
    storageBindings?: SourceStorageBindings): RustSourceErrorBindings | undefined;
  edgeFor(declaration: Node, kind: RustSourceErrorEffectEdge["kind"], effects: RustErrorEffectsFact,
    bindings: RustSourceErrorBindings | undefined): RustSourceErrorEffectEdge | undefined;
}

export function createRustSourceErrorEffectSelection(walk: RustFactWalk): RustSourceErrorEffectSelection {
  const native = walk.context.callableValues.native;
  const inputs = new Map(native.inputs.map(input => [input.implementation.identity, input]));
  const origins = new Map<string, { readonly origin: RustNativeErrorEffect; readonly selected: RustNativeErrorEffect }>();
  const register = (errors: readonly RustNativeErrorEffect[]): boolean => {
    if (mergeRustErrorEffects([{ localErrors: false, nativeErrors: errors }]) === undefined) return false;
    for (const source of errors) {
      const previous = origins.get(source.identity);
      if (previous !== undefined && !rustTargetTypeRefEquals(previous.selected.errorType, source.errorType)) return false;
    }
    for (const source of errors) {
      if (origins.has(source.identity)) continue;
      const selected = Object.freeze({ identity: source.identity, errorType: snapshotClosedMetadata(source.errorType) });
      origins.set(source.identity, { origin: selected, selected });
    }
    return true;
  };
  for (const call of native.calls) {
    if (!register([{ identity: call.invocationErrorSource, errorType: call.invocationError },
      ...call.awaitErrors.map((errorType, index) => ({ identity: call.awaitErrorSources[index]!, errorType }))]))
      throw new Error("Native input error channels require one exact identity and carrier.");
  }
  const bindingsFor: RustSourceErrorEffectSelection["bindingsFor"] = (node, declaration, carriers, storageBindings) => {
    const signature = walk.context.facts.getSelectedTargetCall(node);
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey);
    const generics = rustTargetGenericBindingsForArguments(signature?.member.genericParameters ?? [],
      operation?.kind === "source-call" ? operation.targetGenericArguments ?? [] : []);
    if (generics === undefined) return undefined;
    const caller = sourceEnclosingCallable(node, walk.context.ast);
    const available = new Set(caller === undefined ? [] : [...native.inputsFor(caller), ...native.capturesFor(caller)]);
    const types = new Map(generics.types);
    const lifetimes = new Map<string, RustLifetimeRef>(generics.lifetimes);
    const consts = new Map<string, RustTargetConstArgument>(generics.consts);
    const bindSignature = (pattern: TargetTypeRef, actual: TargetTypeRef): boolean => {
      const formalCarrier = rustOptionElementCarrier(pattern) ?? pattern;
      const actualCarrier = rustOptionElementCarrier(actual) ?? actual;
      const formal = rustGenericCallableProtocol(formalCarrier) ?? rustCallableProtocol(formalCarrier) ??
        rustNativeCallableProtocol(formalCarrier);
      const supplied = rustGenericCallableProtocol(actualCarrier) ?? rustCallableProtocol(actualCarrier) ??
        rustNativeCallableProtocol(actualCarrier);
      if (formal === undefined || supplied === undefined) return false;
      const template = substituteRustTargetGenerics({ kind: "tuple", elements: [...formal.parameters, formal.result] },
        types, lifetimes, consts);
      const references = rustTargetGenericReferences(template);
      if (references.typeIdentities.length === 0 && references.lifetimeIdentities.length === 0 &&
        references.constIdentities.length === 0) return true;
      const inferred = inferRustTargetGenericBindings(template,
        { kind: "tuple", elements: [...supplied.parameters, supplied.result] }, {
          typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
          constIdentities: new Set(references.constIdentities),
        });
      if (inferred === undefined) return false;
      for (const [identity, carrier] of types) types.set(identity,
        substituteRustTargetGenerics(carrier, inferred.types, inferred.lifetimes, inferred.consts));
      for (const [identity, lifetime] of lifetimes) lifetimes.set(identity,
        inferred.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime);
      for (const [identity, value] of consts) {
        const substituted = substituteRustTargetGenericArgument({ kind: "const", value },
          inferred.types, inferred.lifetimes, inferred.consts);
        if (substituted.kind !== "const") return false;
        consts.set(identity, substituted.value);
      }
      for (const [identity, carrier] of inferred.types) {
        const previous = types.get(identity);
        if (previous !== undefined && !rustTargetTypeRefEquals(previous, carrier)) return false;
        types.set(identity, carrier);
      }
      for (const [identity, lifetime] of inferred.lifetimes) {
        const previous = lifetimes.get(identity);
        if (previous !== undefined && rustLifetimeKey(previous) !== rustLifetimeKey(lifetime)) return false;
        lifetimes.set(identity, lifetime);
      }
      for (const [identity, value] of inferred.consts) {
        const previous = consts.get(identity);
        if (previous !== undefined && closedMetadataKey(previous) !== closedMetadataKey(value)) return false;
        consts.set(identity, value);
      }
      return true;
    };
    const producers = new Map<string, RustNativeCallableProducer>();
    const bindings = new Set<string>();
    const references = rustTargetGenericReferences({ kind: "tuple", elements: carriers });
    const needed = new Set(references.typeIdentities);
    if (storageBindings !== undefined) for (const input of [...native.inputsFor(declaration), ...native.capturesFor(declaration)]) {
      const signature = rustTargetGenericReferences(substituteRustTargetGenerics(input.carrier, types, lifetimes, consts));
      if (signature.typeIdentities.some(identity => references.typeIdentities.includes(identity)) ||
        signature.lifetimeIdentities.some(identity => references.lifetimeIdentities.includes(identity)) ||
        signature.constIdentities.some(identity => references.constIdentities.includes(identity))) needed.add(input.implementation.identity);
    }
    for (const identity of needed) {
      const input = inputs.get(identity);
      if (input === undefined || bindings.has(identity)) continue;
      bindings.add(identity);
      if (storageBindings === undefined && input.owner !== declaration) {
        if (!available.has(input)) return undefined;
        continue;
      }
      const selected = storageBindings === undefined
        ? walk.context.callableValues.nativeStorage.invocationOriginsFor(input, node, caller)
        : walk.context.sourceStorage.boundOriginsFor(input.subject, storageBindings);
      if (selected.kind !== "resolved") return undefined;
      let actual: TargetTypeRef | undefined;
      let producer: RustNativeCallableProducer | undefined;
      for (const subject of selected.subjects) {
        const parameter = native.inputs.find(candidate => candidate.subject === subject);
        if (parameter !== undefined) {
          if (producer !== undefined || actual !== undefined && !rustTargetTypeRefEquals(actual, parameter.implementation)) return undefined;
          actual = parameter.implementation;
          if (storageBindings !== undefined && !bindSignature(input.carrier, parameter.carrier)) return undefined;
        } else {
          if (rustOptionElementCarrier(input.carrier) !== undefined && subject.projection.length === 0 &&
            isRustAbsenceCarrier(walk.context.facts.getRuntimeCarrierFact(subject.node)?.carrier)) continue;
          const candidate = subject.projection.length === 0
            ? walk.context.callableValues.nativeProducers.forDeclaration(subject.node) : undefined;
          if (candidate === undefined || actual !== undefined || producer !== undefined && candidate !== producer) return undefined;
          producer = candidate;
          if (storageBindings !== undefined) {
            const operation = walk.context.facts.get(subject.node, rustTargetOperationFactKey);
            const carrier = operation?.kind === "closure" ? operation.resultCarrier
              : walk.context.facts.getRuntimeCarrierFact(subject.node)?.carrier;
            if (carrier === undefined || !bindSignature(input.carrier, carrier)) return undefined;
          }
        }
      }
      if (actual !== undefined) types.set(identity, actual);
      else if (producer !== undefined) producers.set(identity, producer);
      else return undefined;
    }
    const substitute = (carrier: TargetTypeRef): TargetTypeRef | undefined => {
      let valid = true;
      const selected = substituteRustTargetGenerics(carrier, types, lifetimes, consts, (type, original) => {
        if (original.kind !== "associated-type" || original.owner.kind !== "type-parameter") return type;
        const producer = producers.get(original.owner.identity);
        const input = inputs.get(original.owner.identity);
        if (producer === undefined || input === undefined) return type;
        const sourceItem = original.trait?.sourceItem;
        const protocol = sourceItem === undefined ? undefined : native.protocolForSourceItem(sourceItem.fileName, sourceItem.typeName);
        if (protocol === undefined) { valid = false; return type; }
        const channels = ["invocation" as const, ...(protocol.completion?.futures.map(future => future.ordinal) ?? [])];
        const channel = channels.find(channel => {
          const expected = original.trait === undefined ? undefined : rustNativeCallableErrorType(
            { protocol, trait: original.trait }, original.owner, channel, original.genericArguments ?? []);
          return expected !== undefined && rustTargetTypeRefEquals(expected, original);
        });
        const replacement = channel === undefined ? undefined : walk.context.callableValues.nativeProducers.errorFor(
          producer.declaration, channel === "invocation" ? "invoke" : channel);
        if (replacement === undefined) { valid = false; return type; }
        return substituteRustTargetGenerics(replacement, types, lifetimes, consts);
      });
      return valid && isRustTargetTypeRef(selected) ? selected : undefined;
    };
    return Object.freeze({ types, lifetimes, consts, substitute });
  };
  const edgeFor: RustSourceErrorEffectSelection["edgeFor"] = (declaration, kind, effects, bindings) => {
    if (effects.nativeErrors.length === 0) return Object.freeze({ declaration, kind, effects,
      nativeErrors: Object.freeze([]) });
    if (bindings === undefined) return undefined;
    const nativeErrors: RustSourceErrorEffectEdge["nativeErrors"][number][] = [];
    for (const source of effects.nativeErrors) {
      const recorded = origins.get(source.identity);
      if (recorded === undefined || !rustTargetTypeRefEquals(recorded.selected.errorType, source.errorType)) return undefined;
      const origin = recorded.origin;
      const errorType = bindings.substitute(source.errorType);
      if (errorType === undefined) return undefined;
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
  return Object.freeze({ register, bindingsFor, edgeFor });
}
