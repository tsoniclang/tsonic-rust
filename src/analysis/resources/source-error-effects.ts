import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustErrorEffectsFact, RustNativeErrorEffect } from "../../target-model/records/error-effects.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { mergeRustErrorEffects } from "../errors/error-effects.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";

import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics, substituteRustTargetGenericArgument } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustPhysicalPayloadFor } from "../../target-model/types/physical-payloads.js";
import type { RustNativeCallableProducer } from "../callables/native-producers.js";
import { rustNativeCallableErrorChannel } from "../callables/native-protocols.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import type { SourceStorageBindings } from "@tsonic/target-api/analysis";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustRetainedCallSubstitutions } from "../callables/retained-call-lifetimes.js";
import type { RustTargetConstArgument } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustNativeStoragePlan } from "../callables/native-storage.js";
import type { RustNativeCallableInputPlan } from "../callables/native-inputs.js";
import type { RustNativeCallableProducerPlan } from "../callables/native-producers.js";

type RustSourceErrorContext = Pick<RustAnalysisContext, "ast" | "records" | "sourceStorage" | "typeDefinitions"> & {
  readonly callableValues: {
    readonly native: RustNativeCallableInputPlan;
    readonly nativeProducers: Pick<RustNativeCallableProducerPlan, "forDeclaration" | "errorFor">;
    readonly nativeStorage: Pick<RustNativeStoragePlan, "invocationWitnessFor" | "invocationOriginsFor">;
  };
};

export interface RustSourceErrorBindings extends RustTargetGenericBindings {
  readonly identity: string;
  substitute(carrier: TargetTypeRef): TargetTypeRef | undefined;
  complete(carrier: TargetTypeRef, physical: Pick<RustNativeStoragePlan, "invocationInputFor" | "boundSubjectFor">): TargetTypeRef | undefined;
}

export type RustSourceErrorBindingDemand =
  | { readonly kind: "carrier"; readonly carrier: TargetTypeRef }
  | { readonly kind: "source-effect"; readonly effect: RustNativeErrorEffect };

export interface RustSourceErrorEffectSelection {
  register(errors: readonly RustNativeErrorEffect[]): boolean;
  bindingsFor(node: Node, declaration: Node, demands: readonly RustSourceErrorBindingDemand[],
    activation?: { readonly storageBindings: SourceStorageBindings;
      readonly genericBindings: RustTargetGenericBindings }): RustSourceErrorBindings | undefined;
  edgeFor(declaration: Node, kind: RustSourceErrorEffectEdge["kind"], effects: RustErrorEffectsFact,
    bindings: RustSourceErrorBindings | undefined): RustSourceErrorEffectEdge | undefined;
  pending(error: RustNativeErrorEffect, complete: () => RustNativeErrorEffect | undefined): boolean;
  complete(error: RustNativeErrorEffect,
    physical: Pick<RustNativeStoragePlan, "invocationInputFor" | "boundSubjectFor">): RustNativeErrorEffect | undefined;
}

export function createRustSourceErrorEffectSelection(walk: { readonly context: RustSourceErrorContext }): RustSourceErrorEffectSelection {
  const native = walk.context.callableValues.native;
  const inputs = new Map(native.inputs.map(input => [input.implementation.identity, input]));
  const origins = new Map<string, { readonly origin: RustNativeErrorEffect; readonly selected: RustNativeErrorEffect }>();
  const pending = new Map<string, (physical: Pick<RustNativeStoragePlan, "invocationInputFor" | "boundSubjectFor">) => RustNativeErrorEffect | undefined>();
  const completed = new Map<string, RustNativeErrorEffect>();
  const active = new Set<string>();
  const bindingIdentities = new WeakMap<SourceStorageBindings, number>();
  let nextBindingIdentity = 0;
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
  if (!register([{ identity: rustJsRejectionErrorIdentity, errorType: rustJsValueTargetType() }]))
    throw new Error("JS object rejection requires its one canonical identity and carrier.");
  const bindingsFor: RustSourceErrorEffectSelection["bindingsFor"] = (node, declaration, demands, activation) => {
    const carriers: TargetTypeRef[] = [];
    const pendingInputs = new Set<string>();
    const immediateInputs = new Set<string>();
    for (const demand of demands) {
      let carrier: TargetTypeRef;
      let references: Set<string>;
      if (demand.kind === "carrier") {
        if (!isRustTargetTypeRef(demand.carrier)) return undefined;
        carrier = demand.carrier;
        references = immediateInputs;
      } else if (demand.kind === "source-effect") {
        const effect = demand.effect;
        const recorded = effect === undefined ? undefined : origins.get(effect.identity);
        if (recorded === undefined || !rustTargetTypeRefEquals(recorded.selected.errorType, effect.errorType)) return undefined;
        carrier = effect.errorType;
        references = pending.has(effect.identity) ? pendingInputs : immediateInputs;
      } else return undefined;
      carriers.push(carrier);
      for (const identity of rustTargetGenericReferences(carrier, "metadata").typeIdentities) references.add(identity);
    }
    const signature = walk.context.records.selectedCall.get(node);
    const operation = walk.context.records.targetOperation.get(node);
    const storageBindings = activation?.storageBindings;
    const generics = activation === undefined ? rustTargetGenericBindingsForArguments(signature?.member.genericParameters ?? [],
      operation?.kind === "source-call" ? operation.targetGenericArguments ?? [] : []) : activation.genericBindings;
    if (generics === undefined) return undefined;
    const caller = sourceEnclosingCallable(node, walk.context.ast);
    const available = new Set(caller === undefined ? [] : [...native.inputsFor(caller), ...native.capturesFor(caller)]);
    const types = new Map(generics.types);
    const lifetimes = new Map<string, RustLifetimeRef>(activation === undefined ? [...generics.lifetimes,
      ...rustRetainedCallSubstitutions(walk.context.records, node)] : generics.lifetimes);
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
    const physicalInputs = new Map<string, TargetTypeRef>();
    const completedInputs = new Map<string, TargetTypeRef>();
    const absentInputs = new Set<string>();
    const deferredInputs = new Set<string>();
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
      if (input.owner !== declaration && !available.has(input) && pendingInputs.has(identity) && !immediateInputs.has(identity)) {
        deferredInputs.add(identity);
        continue;
      }
      if (storageBindings === undefined && input.owner !== declaration) {
        if (!available.has(input)) return undefined;
        continue;
      }
      const absenceWitness = walk.context.callableValues.nativeStorage.invocationWitnessFor(input, node);
      if (absenceWitness !== undefined) {
        absentInputs.add(identity);
        types.set(identity, absenceWitness);
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
            isRustAbsenceCarrier(walk.context.records.runtimeCarrier.get(subject.node)?.carrier)) continue;
          const candidate = subject.projection.length === 0
            ? walk.context.callableValues.nativeProducers.forDeclaration(subject.node) : undefined;
          if (candidate === undefined || actual !== undefined || producer !== undefined && candidate !== producer) return undefined;
          producer = candidate;
          if (storageBindings !== undefined) {
            const operation = walk.context.records.targetOperation.get(subject.node);
            const carrier = operation?.kind === "closure" ? operation.resultCarrier
              : walk.context.records.runtimeCarrier.get(subject.node)?.carrier;
            if (carrier === undefined || !bindSignature(input.carrier, carrier)) return undefined;
          }
        }
      }
      if (actual !== undefined) types.set(identity, actual);
      else if (producer !== undefined) {
        const carrier = substituteRustTargetGenerics(input.carrier, types, lifetimes, consts);
        producers.set(identity, producer);
        physicalInputs.set(identity, carrier);
      }
      else return undefined;
    }
    const substitute = (carrier: TargetTypeRef, selectedTypes: ReadonlyMap<string, TargetTypeRef>): TargetTypeRef | undefined => {
      let valid = true;
      const selected = substituteRustTargetGenerics(carrier, selectedTypes, lifetimes, consts, (type, original) => {
        if (original.kind !== "associated-type" || original.owner.kind !== "type-parameter") return type;
        const producer = producers.get(original.owner.identity);
        const input = inputs.get(original.owner.identity);
        if (input === undefined || producer === undefined && !absentInputs.has(original.owner.identity)) return type;
        const channel = rustNativeCallableErrorChannel(input, input.implementation, original);
        if (channel === undefined) return type;
        const replacement: TargetTypeRef | undefined = absentInputs.has(original.owner.identity)
          ? { kind: "target-named", id: rustInfallibleTargetId } : producer === undefined ? undefined
          : walk.context.callableValues.nativeProducers.errorFor(producer.declaration, channel === "invocation" ? "invoke" : channel);
        if (replacement === undefined) { valid = false; return type; }
        return substituteRustTargetGenerics(replacement, selectedTypes, lifetimes, consts);
      });
      return valid && isRustTargetTypeRef(selected) ? selected : undefined;
    };
    if (storageBindings !== undefined && !bindingIdentities.has(storageBindings)) bindingIdentities.set(storageBindings, nextBindingIdentity++);
    const identity = closedMetadataKey({ invocation: sourceNodeIdentity(walk.context.ast, node),
      declaration: sourceNodeIdentity(walk.context.ast, declaration),
      storage: storageBindings === undefined ? null : bindingIdentities.get(storageBindings),
      types: [...types], lifetimes: [...lifetimes], consts: [...consts],
      producers: [...producers].map(([identity, producer]) => [identity, producer.identity]), absent: [...absentInputs] });
    return Object.freeze({ types, lifetimes, consts, identity,
      substitute: (carrier: TargetTypeRef) => substitute(carrier, types),
      complete(carrier: TargetTypeRef, physical: Pick<RustNativeStoragePlan, "invocationInputFor" | "boundSubjectFor">) {
        const logical = substitute(carrier, types);
        if (logical === undefined) return undefined;
        const remaining = new Set(rustTargetGenericReferences(logical, "metadata").typeIdentities);
        if ([...deferredInputs].some(identity => remaining.has(identity))) return undefined;
        const needed = new Set(rustTargetGenericReferences(logical).typeIdentities);
        const selectedTypes = new Map(types);
        for (const [identity, logical] of physicalInputs) {
          if (!needed.has(identity)) continue;
          const previous = completedInputs.get(identity);
          if (previous !== undefined) { selectedTypes.set(identity, previous); continue; }
          const input = inputs.get(identity)!;
          const selected = storageBindings === undefined ? physical.invocationInputFor(input, node, caller)
            : physical.boundSubjectFor(input.subject, logical, storageBindings);
          const payload = selected.kind === "unresolved" ? undefined : rustPhysicalPayloadFor(logical, selected.carrier,
            rustOptionElementCarrier(logical) ?? logical, walk.context.typeDefinitions);
          if (payload === undefined) return undefined;
          completedInputs.set(identity, payload);
          selectedTypes.set(identity, payload);
        }
        return substitute(carrier, selectedTypes);
      },
    });
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
      const references = rustTargetGenericReferences(errorType, "metadata");
      const sourceComplete = !pending.has(source.identity) && !pending.has(origin.identity) &&
        references.typeIdentities.length === 0 && references.lifetimeIdentities.length === 0 &&
        references.constIdentities.length === 0;
      const identity = sourceComplete ? substitutedErrorIdentity(source, origin, errorType)
        : `pending-native-error:${closedMetadataKey({ source: origin.identity,
          errorType, bindings: bindings.identity })}`;
      let target = origins.get(identity)?.selected;
      if (target === undefined) {
        target = Object.freeze({ identity, errorType: snapshotClosedMetadata(errorType) });
        origins.set(identity, { origin, selected: target });
        if (!sourceComplete) pending.set(identity, physical => {
          const completedSource = complete(source, physical);
          if (completedSource === undefined) return undefined;
          const completedOrigin = complete(origin, physical);
          if (completedOrigin === undefined) return undefined;
          const selectedType = bindings.complete(completedSource.errorType, physical);
          if (selectedType === undefined) return undefined;
          const selectedIdentity = substitutedErrorIdentity(completedSource, completedOrigin, selectedType);
          return Object.freeze({ identity: selectedIdentity, errorType: snapshotClosedMetadata(selectedType) });
        });
      } else if (!rustTargetTypeRefEquals(target.errorType, errorType)) return undefined;
      nativeErrors.push(Object.freeze({ source, target }));
    }
    const selectedEffects = mergeRustErrorEffects([{ localErrors: effects.localErrors,
      nativeErrors: nativeErrors.map(entry => entry.target) }]);
    return selectedEffects === undefined ? undefined : Object.freeze({ declaration, kind, effects: selectedEffects,
      nativeErrors: Object.freeze(nativeErrors) });
  };
  const complete: RustSourceErrorEffectSelection["complete"] = (error, physical) => {
    const registered = origins.get(error.identity);
    if (registered === undefined || !rustTargetTypeRefEquals(registered.selected.errorType, error.errorType)) return undefined;
    const previous = completed.get(error.identity);
    if (previous !== undefined) return previous;
    if (active.has(error.identity) || active.size >= 128) return undefined;
    const selected = pending.get(error.identity);
    if (selected === undefined) return error;
    active.add(error.identity);
    try {
      const result = selected(physical);
      if (result !== undefined) completed.set(error.identity, result);
      return result;
    } finally { active.delete(error.identity); }
  };
  return Object.freeze({ register, bindingsFor, edgeFor, complete,
    pending(error: RustNativeErrorEffect, select: () => RustNativeErrorEffect | undefined) {
      if (!register([error])) return false;
      pending.set(error.identity, select);
      return true;
    },
  });
}

function substitutedErrorIdentity(source: RustNativeErrorEffect, origin: RustNativeErrorEffect, errorType: TargetTypeRef): string {
  return rustTargetTypeRefEquals(errorType, source.errorType) ? source.identity
    : rustTargetTypeRefEquals(errorType, origin.errorType) ? origin.identity
      : `native-error-substitution:${closedMetadataKey({ source: origin.identity, errorType })}`;
}
