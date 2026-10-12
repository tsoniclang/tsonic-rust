import type { Node } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustGenericCallableInvocationFact } from "../facts/generic-callable-effects.js";
import type { RustSourceCallEffectsFact } from "../facts/object-methods.js";
import { selectRustGenericCallableInvocationStorage } from "../callables/generic-dispatch.js";
import { rustGenericCallableInvocationBindings } from "../callables/generic-bindings.js";
import { selectRustGenericCallableErrors } from "../callables/generic-errors.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";

export function selectRustGenericCallableInvocation(
  node: Node, context: RustAnalysisContext,
  effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined,
): RustGenericCallableInvocationFact | undefined {
  const storage = selectRustGenericCallableInvocationStorage(node, {
    ast: context.ast, facts: context.facts, generic: context.callableValues.generic,
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
  const instantiate = (sources: typeof selected.invocation): typeof selected.invocation => Object.freeze(sources.map(source => {
    const errorType = substituteRustTargetGenerics(source.errorType, bindings.types, bindings.lifetimes, bindings.consts);
    return Object.freeze({ ...source, errorType,
      identity: `generic-callable-error:${closedMetadataKey({ origin: source.identity, errorType })}` });
  }));
  return Object.freeze({ carrier: snapshotClosedMetadata(storage.carrier), ownerFileName: definition.ownerFileName,
    effects: selected.effects, invocation: instantiate(selected.invocation), awaiting: instantiate(selected.awaiting) });
}
