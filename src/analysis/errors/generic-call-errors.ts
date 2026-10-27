import type { Node } from "@tsonic/tsts";
import { rustSourceCallCallableStorageCarrier } from "../../policy/operations/members/native-contracts.js";
import type { SourceStorageProducer } from "@tsonic/target-api/analysis";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustGenericCallableInvocationFact } from "../../target-model/records/generic-callable-effects.js";
import type { RustSourceCallEffectsFact } from "../../target-model/records/object-methods.js";
import { selectRustGenericCallableInvocationStorage } from "../callables/generics/generic-dispatch.js";
import { rustGenericCallableInvocationBindings } from "../callables/generics/generic-bindings.js";
import { selectRustGenericCallableErrors } from "../callables/generics/generic-errors.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { Node_Expression, sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { RustNativeErrorEffect } from "../../target-model/records/error-effects.js";
import type { RustGenericCallablePlan } from "../callables/generics/generic-values.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeCallableInputPlan } from "../callables/native/native-inputs.js";
import type { RustNativeStoragePlan } from "../callables/storage/native-storage.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";

type RustSourceGenericInvocationContext = Pick<RustAnalysisContext, "ast" | "records" | "sourceStorage" | "structuralShapes"> & {
  readonly callableValues: {
    readonly generic: Pick<RustGenericCallablePlan, "definitionFor" | "implementationFor">;
    readonly native: Pick<RustNativeCallableInputPlan, "bindingsFor">;
    readonly nativeProducers: Pick<RustNativeCallableProducerPlan, "forDeclaration" | "errorFor">;
    readonly nativeStorage: Pick<RustNativeStoragePlan, "genericBindingsFor" | "extendRecordMemberProducers">;
  };
};

export interface RustSourceGenericCallableInvocation {
  readonly selection: RustGenericCallableInvocationFact;
  // Pending channels carry a producer's own error carrier, which names the producer's generic and captured environment;
  // callers of the invoking declaration bind them only once the invocation completes.
  readonly pendingErrors: ReadonlySet<string>;
  complete(context: RustAnalysisContext): {
    readonly selection: RustGenericCallableInvocationFact;
    readonly replacements: ReadonlyMap<string, RustNativeErrorEffect>;
  } | undefined;
}

export function prepareRustGenericCallableInvocation(
  node: Node, context: RustSourceGenericInvocationContext,
  effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined,
  sourceErrors: Pick<RustSourceErrorEffectSelection, "bindingsFor">,
): RustSourceGenericCallableInvocation | undefined {
  const { ast, records, sourceStorage: storage, callableValues } = context;
  const operation = records.targetOperation.get(node);
  if (operation?.kind !== "source-call") return undefined;
  const target = operation.target;
  // A structural method is stored, and its generic family defined, with the receiver as its first parameter.
  const logical = target.form === "callable" ? target.carrier
    : target.form === "structural-method" ? rustSourceCallCallableStorageCarrier(operation, context.structuralShapes)
    : target.form === "constructor-value" ? target.callableCarrier : undefined;
  if (rustGenericCallableValue(logical) === undefined) return undefined;
  const callee = Node_Expression(ast, node);
  const subject = callee === undefined ? undefined : storage.subjectFor(callee);
  const owner = sourceEnclosingCallable(node, ast);
  const bindings = owner === undefined ? storage.emptyBindings : callableValues.native.bindingsFor(owner);
  const reached = subject?.kind !== "resolved" || bindings === undefined ? undefined : storage.storageProducersFor(subject.subject, bindings);
  const producers = reached === undefined ? undefined : callableValues.nativeStorage.extendRecordMemberProducers(reached);
  const definition = logical === undefined ? undefined : callableValues.generic.definitionFor(logical);
  if (definition === undefined || producers?.kind !== "complete" || producers.producers.length === 0) return undefined;
  const invocation: RustGenericCallableInvocationFact["invocation"][number][] = [];
  const awaiting: RustGenericCallableInvocationFact["awaiting"][number][] = [];
  const requests: { readonly producer: SourceStorageProducer; readonly channel: "invocation" | "awaiting"; readonly identity: string }[] = [];
  const implementationRequests: { readonly declaration: Node; readonly channel: "invocation" | "awaiting"; readonly identity: string }[] = [];
  const effects: RustSourceCallEffectsFact[] = [];
  // A callee supplied by an input (a parameter or a method value read from one) carries some member of the family its
  // logical carrier names, so its channels are those of every implementation of that family.
  const inputCallee = producers.producers.every(selected => selected.subject.kind === "input");
  // A callee read from a record member stores the member's whole family, including values written by activations this
  // invocation does not reach; its channels are those of each implementation the member stores.
  const memberCallee = !inputCallee && producers !== reached;
  const familyDeclarations = inputCallee ? definition.implementations.map(implementation => implementation.declaration)
    : memberCallee ? [...new Set(producers.producers.map(selected => selected.subject.node))] : [];
  for (const [ordinal, declaration] of familyDeclarations.entries()) {
    const producer = callableValues.nativeProducers.forDeclaration(declaration);
    const effect = effectsFor(declaration);
    if (producer === undefined || effect === undefined) return undefined;
    effects.push(effect);
    for (const channel of ["invocation", "awaiting"] as const) {
      if (effect[channel] !== "fallible") continue;
      const error = callableValues.nativeProducers.errorFor(declaration, channel === "invocation" ? "invoke" : 0);
      if (error === undefined) return undefined;
      const identity = `pending-generic-error:${closedMetadataKey({ invocation: sourceNodeIdentity(ast, node),
        producer: producer.identity, implementation: ordinal, channel, errorType: error })}`;
      const values = channel === "invocation" ? invocation : awaiting;
      if (values.some(value => value.identity === identity)) continue;
      values.push(Object.freeze({ identity, variant: `Error${values.length}`, errorType: snapshotClosedMetadata(error) }));
      implementationRequests.push(Object.freeze({ declaration, channel, identity }));
    }
  }
  for (const [ordinal, selected] of (inputCallee || memberCallee ? [] : producers.producers).entries()) {
    const subject = selected.subject;
    if (subject.kind !== "value" || subject.projection.length !== 0) return undefined;
    const declaration = subject.node;
    const implementation = callableValues.generic.implementationFor(declaration);
    const producer = callableValues.nativeProducers.forDeclaration(declaration);
    const effect = effectsFor(declaration);
    const activation = storage.bindingsForInvocation(declaration, node, bindings!, selected);
    const generics = activation.kind === "unresolved" ? undefined
      : callableValues.nativeStorage.genericBindingsFor(declaration, activation.bindings);
    if (implementation === undefined || producer === undefined || effect === undefined || generics?.kind !== "resolved") return undefined;
    effects.push(effect);
    for (const channel of ["invocation", "awaiting"] as const) {
      if (effect[channel] !== "fallible") continue;
      const error = callableValues.nativeProducers.errorFor(declaration, channel === "invocation" ? "invoke" : 0);
      if (error === undefined) return undefined;
      const bound = activation.kind === "unresolved" ? undefined : sourceErrors.bindingsFor(node, declaration, [error], {
        storageBindings: activation.bindings, genericBindings: generics.bindings,
      });
      const errorType = bound?.substitute(error);
      if (errorType === undefined) return undefined;
      const identity = `pending-generic-error:${closedMetadataKey({ invocation: sourceNodeIdentity(ast, node),
        producer: producer.identity, activation: ordinal, channel, errorType })}`;
      const values = channel === "invocation" ? invocation : awaiting;
      if (values.some(value => value.identity === identity)) continue;
      values.push(Object.freeze({ identity, variant: `Error${values.length}`, errorType: snapshotClosedMetadata(errorType) }));
      requests.push(Object.freeze({ producer: selected, channel, identity }));
    }
  }
  const selection: RustGenericCallableInvocationFact = Object.freeze({ carrier: snapshotClosedMetadata(logical!),
    ownerFileName: definition.ownerFileName, invocation: Object.freeze(invocation), awaiting: Object.freeze(awaiting),
    effects: Object.freeze({ invocation: invocation.length === 0 ? "infallible" : "fallible",
      awaiting: awaiting.length !== 0 ? "fallible" : effects.some(effect => effect.awaiting !== "not-applicable")
        ? "infallible" : "not-applicable" }) });
  return Object.freeze({ selection, pendingErrors: new Set([...requests, ...implementationRequests].map(request => request.identity)),
    complete(finalContext: RustAnalysisContext) {
      const completed = resolveRustGenericCallableInvocation(node, finalContext, effectsFor);
      if (completed === undefined) return undefined;
      const replacements = new Map<string, RustNativeErrorEffect>();
      for (const request of requests) {
        const selected = completed.forProducer(request.producer, logical!, request.channel);
        if (selected === undefined) return undefined;
        replacements.set(request.identity, selected);
      }
      for (const request of implementationRequests) {
        const selected = completed.forImplementation(request.declaration, request.channel);
        if (selected === undefined) return undefined;
        replacements.set(request.identity, selected);
      }
      return Object.freeze({ selection: completed.selection, replacements });
    },
  });
}

export function selectRustGenericCallableInvocation(
  node: Node, context: RustAnalysisContext,
  effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined,
): RustGenericCallableInvocationFact | undefined {
  return resolveRustGenericCallableInvocation(node, context, effectsFor)?.selection;
}

function resolveRustGenericCallableInvocation(
  node: Node, context: RustAnalysisContext,
  effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined,
): { readonly selection: RustGenericCallableInvocationFact;
  forProducer(producer: SourceStorageProducer, logical: TargetTypeRef,
    channel: "invocation" | "awaiting"): RustNativeErrorEffect | undefined;
  forImplementation(declaration: Node, channel: "invocation" | "awaiting"): RustNativeErrorEffect | undefined } | undefined {
  const storage = selectRustGenericCallableInvocationStorage(node, {
    ast: context.ast, records: context.records, generic: context.callableValues.generic,
    nativeStorage: context.callableValues.nativeStorage,
    structuralShapes: context.structuralShapes,
  });
  if (storage === undefined) return undefined;
  const { operation, definition } = storage;
  const { physical } = context.callableValues.generic;
  const bindings = rustGenericCallableInvocationBindings(
    definition, storage.carrier, operation.targetGenericArguments ?? [], physical);
  if (bindings === undefined) return undefined;
  const selected = selectRustGenericCallableErrors(definition, {
    ast: context.ast, sourceLifetimes: context.sourceLifetimes, physical,
    producers: context.callableValues.nativeProducers, effectsFor,
  });
  if (selected === undefined) return undefined;
  const instantiateOne = (source: typeof selected.invocation[number]): typeof source => {
    const errorType = substituteRustTargetGenerics(source.errorType, bindings.types, bindings.lifetimes, bindings.consts);
    return Object.freeze({ ...source, errorType,
      identity: `generic-callable-error:${closedMetadataKey({ origin: source.identity, errorType })}` });
  };
  const instantiate = (sources: typeof selected.invocation): typeof selected.invocation => Object.freeze(sources.map(instantiateOne));
  const selection = Object.freeze({ carrier: snapshotClosedMetadata(storage.carrier), ownerFileName: definition.ownerFileName,
    effects: selected.effects, invocation: instantiate(selected.invocation), awaiting: instantiate(selected.awaiting) });
  return Object.freeze({ selection,
    forProducer(producer: SourceStorageProducer, logical: TargetTypeRef, channel: "invocation" | "awaiting") {
      const supplied = context.callableValues.nativeStorage.boundSubjectFor(producer.subject, logical, producer.bindings);
      if (supplied.kind === "unresolved") return undefined;
      const source = physical.definitionFor(supplied.carrier);
      // A producer stored with other values (a record member family) is the one member built from its implementation.
      const built = source?.members.filter(member => member.implementation.declaration === producer.subject.node) ?? [];
      const sourceMember = built.length === 1 ? built[0] : undefined;
      if (sourceMember?.implementation.declaration !== producer.subject.node) return undefined;
      const conversion = physical.conversionFor(supplied.carrier, storage.carrier);
      const mappings = conversion?.kind === "variants"
        ? conversion.members.filter(mapping => mapping.source === sourceMember) : undefined;
      const member = conversion?.kind === "identity" ? sourceMember
        : mappings?.length === 1 ? mappings[0]!.target : undefined;
      const error = member === undefined || !definition.members.includes(member) ? undefined : selected.members.get(member)?.[channel];
      return error === undefined ? undefined : instantiateOne(error);
    },
    // Every physical member built from one implementation carries the same channel error at this invocation, or the
    // channel is not exact.
    forImplementation(declaration: Node, channel: "invocation" | "awaiting") {
      const errors = definition.members.filter(member => member.implementation.declaration === declaration)
        .map(member => selected.members.get(member)?.[channel]);
      if (errors.length === 0 || errors.some(error => error === undefined)) return undefined;
      const [first, ...rest] = errors.map(error => instantiateOne(error!));
      return rest.every(error => rustTargetTypeRefEquals(error.errorType, first!.errorType)) ? first : undefined;
    },
  });
}
