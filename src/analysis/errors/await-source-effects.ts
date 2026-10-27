import type { Node } from "@tsonic/tsts";
import { asSourceNode, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";

import type { RustErrorEffectsFact } from "../../target-model/records/errors/error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../../target-model/records/callables/await-source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals } from "./source-error-effects.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";
import { selectRustGeneratorSourceErrors } from "./generator-source-effects.js";
import { rustGeneratorSourceInvocationKind } from "../../policy/operations/source-profiles/generator-source-profile.js";
import { rustFutureValueForOperation, rustFutureValueMatchesCarrier } from "../callables/async/future-values.js";

export interface RustAwaitSourceErrorSelection extends RustAwaitSourceErrorBranch {
  readonly invocation: Node;
}

export type RustAwaitSourceErrorResult =
  | { readonly kind: "resolved"; readonly branches: readonly RustAwaitSourceErrorSelection[] }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectRustAwaitSourceErrors(
  walk: RustFactWalk,
  operand: Node,
  branches: readonly TargetTypeRef[],
  effectsFor: (declaration: Node) => RustErrorEffectsFact,
  selection: RustSourceErrorEffectSelection,
  budget: RustEffectsWorkBudget,
): RustAwaitSourceErrorResult {
  const reject = (reason: string): RustAwaitSourceErrorResult => Object.freeze({ kind: "rejected", reason });
  const { sourceStorage: storage, ast, records, callableValues, typeDefinitions: definitions } = walk.context;
  const direct = records.targetOperation.get(operand);
  if (direct?.kind === "provider-operation" && rustGeneratorSourceInvocationKind(direct.operationId) !== "async") {
    const value = rustFutureValueForOperation(direct, records.sourceCallEffects.get(operand), definitions);
    const topology = rustAwaitSelection(direct.resultCarrier, definitions);
    const available = topology === undefined ? [] : rustAwaitSelectionLeaves(topology).filter(leaf => leaf.future !== undefined);
    budget.step();
    if (value !== undefined && branches.length !== 0 && branches.every(branch =>
      available.some(leaf => rustTargetTypeRefEquals(leaf.carrier, branch)) &&
      rustFutureValueMatchesCarrier(value, branch, definitions)))
      return Object.freeze({ kind: "resolved", branches: Object.freeze([]) });
  }
  const subject = storage.subjectFor(operand);
  const owner = sourceEnclosingCallable(operand, ast);
  const bindings = owner === undefined ? storage.emptyBindings : callableValues.native.bindingsFor(owner);
  if (subject.kind !== "resolved") return reject(subject.reason);
  if (bindings === undefined) return reject("The awaited operand has no exact native caller activation bindings.");
  const producers = storage.storageProducersFor(subject.subject, bindings);
  if (producers.kind === "unresolved") return reject(producers.reason);
  if (producers.kind === "open" && producers.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    !producers.producers.some(producer => producer.subject.node === boundary.exposure)))
    return reject(`The awaited producer domain remains open (${[...new Set(producers.boundaries.map(boundary => boundary.kind))].join(", ")}).`);
  const selected: RustAwaitSourceErrorSelection[] = [];
  for (const producer of producers.producers) {
    budget.step();
    if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0) continue;
    const invocation = producer.subject.node;
    const operation = records.targetOperation.get(invocation);
    if (operation?.kind === "provider-operation" && rustGeneratorSourceInvocationKind(operation.operationId) === "async") {
      const receiver = asSourceNode(records.selectedOperation.get(invocation)?.provenance?.sourceReceiver, ast);
      if (receiver === undefined) return reject("An asynchronous generator resume has no original checked receiver.");
      const edge = selectRustGeneratorSourceErrors(walk, receiver, effectsFor, selection, budget);
      const carrier = branches.length === 1 ? branches[0] : undefined;
      if (edge === undefined) return reject("An asynchronous generator resume has no exact original body-error activation.");
      if (carrier === undefined) return reject(`An asynchronous generator resume requires one exact native future branch, received ${branches.length}.`);
      selected.push(Object.freeze({ invocation, carrier: snapshotClosedMetadata(carrier), edge }));
      continue;
    }
    if (operation?.kind !== "source-call" || callableValues.native.callFor(invocation) !== undefined) continue;
    const implementations = storage.invocationImplementationsFor(invocation, producer.bindings);
    if (implementations.kind !== "resolved") return reject(implementations.reason);
    if (!implementations.exact || implementations.nodes.length === 0)
      return reject("An awaited source invocation has no complete original implementation domain.");
    for (const target of implementations.nodes) {
      budget.step();
      const asynchronous = records.asyncFunction.get(target);
      if (asynchronous === undefined) continue;
      const sourceFuture = operation.asyncBody?.declaration === target ? operation.resultCarrier : asynchronous.futureCarrier;
      const topology = rustAwaitSelection(sourceFuture, definitions);
      const activation = storage.bindingsForInvocation(target, invocation, producer.bindings);
      if (topology === undefined) return reject("An original asynchronous source result has no selected native await topology.");
      if (activation.kind !== "resolved") return reject(activation.reason);
      const effects = effectsFor(target);
      let sourceWork = budget.metadata(asynchronous.futureCarrier);
      for (const error of effects.nativeErrors) sourceWork += budget.metadata(error.errorType);
      const replacementWork = budget.metadata(operation.targetGenericArguments);
      budget.expansion(sourceWork, replacementWork);
      const generics = callableValues.nativeStorage.genericBindingsFor(target, activation.bindings);
      if (generics.kind !== "resolved") return reject(generics.reason);
      const substitutions = selection.bindingsFor(invocation, target,
        [asynchronous.futureCarrier, ...selection.bindingCarriersFor(effects.nativeErrors)],
        { storageBindings: activation.bindings, genericBindings: generics.bindings });
      const edge = selection.edgeFor(target, "await", effects, substitutions);
      if (substitutions === undefined) return reject("An original asynchronous invocation has no exact error-channel substitution.");
      if (edge === undefined) return reject("An original asynchronous invocation has no exact deferred error edge.");
      budget.metadata(edge.effects);
      budget.metadata(edge.nativeErrors);
      for (const leaf of rustAwaitSelectionLeaves(topology)) {
        budget.step();
        if (leaf.future === undefined) continue;
        const carrier = substitutions.substitute(leaf.carrier);
        if (carrier === undefined) return reject("An original asynchronous future has no closed native branch substitution.");
        const branch = branches.find(branch => rustTargetTypeRefEquals(branch, carrier));
        if (branch === undefined) return reject("An original asynchronous native future does not equal any admitted awaited branch.");
        const value = Object.freeze({ invocation, carrier: snapshotClosedMetadata(branch), edge });
        const previous = selected.find(previous => previous.invocation === invocation &&
          previous.edge.declaration === target && rustTargetTypeRefEquals(previous.carrier, branch));
        if (previous === undefined) selected.push(value);
        else if (!rustSourceErrorEffectEdgeEquals(previous.edge, edge))
          return reject("One original asynchronous invocation has contradictory closed native error edges.");
      }
    }
  }
  const failure = storage.failureReason();
  return failure === undefined ? Object.freeze({ kind: "resolved", branches: Object.freeze(selected) }) : reject(failure);
}
