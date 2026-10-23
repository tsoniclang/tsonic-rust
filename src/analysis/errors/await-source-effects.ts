import type { Node } from "@tsonic/tsts";
import { asSourceNode, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";

import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../../target-model/records/await-source-error-effects.js";
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

export interface RustAwaitSourceErrorSelection extends RustAwaitSourceErrorBranch {
  readonly invocation: Node;
}

export function selectRustAwaitSourceErrors(
  walk: RustFactWalk,
  operand: Node,
  branches: readonly TargetTypeRef[],
  effectsFor: (declaration: Node) => RustErrorEffectsFact,
  selection: RustSourceErrorEffectSelection,
  budget: RustEffectsWorkBudget,
): readonly RustAwaitSourceErrorSelection[] | undefined {
  const { sourceStorage: storage, ast, records, callableValues, typeDefinitions: definitions } = walk.context;
  const subject = storage.subjectFor(operand);
  const owner = sourceEnclosingCallable(operand, ast);
  const bindings = owner === undefined ? storage.emptyBindings : callableValues.native.bindingsFor(owner);
  if (subject.kind !== "resolved" || bindings === undefined) return undefined;
  const producers = storage.storageProducersFor(subject.subject, bindings);
  if (producers.kind === "unresolved") return undefined;
  if (producers.kind === "open" && producers.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    !producers.producers.some(producer => producer.subject.node === boundary.exposure))) return undefined;
  const selected: RustAwaitSourceErrorSelection[] = [];
  for (const producer of producers.producers) {
    budget.step();
    if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0) continue;
    const invocation = producer.subject.node;
    const operation = records.targetOperation.get(invocation);
    if (operation?.kind === "provider-operation" && rustGeneratorSourceInvocationKind(operation.operationId) === "async") {
      const receiver = asSourceNode(records.selectedOperation.get(invocation)?.provenance?.sourceReceiver, ast);
      const edge = receiver === undefined ? undefined
        : selectRustGeneratorSourceErrors(walk, receiver, effectsFor, selection, budget);
      const carrier = branches.length === 1 ? branches[0] : undefined;
      if (edge === undefined || carrier === undefined) return undefined;
      selected.push(Object.freeze({ invocation, carrier: snapshotClosedMetadata(carrier), edge }));
      continue;
    }
    if (operation?.kind !== "source-call" || callableValues.native.callFor(invocation) !== undefined) continue;
    const implementations = storage.invocationImplementationsFor(invocation, producer.bindings);
    if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length === 0) return undefined;
    for (const target of implementations.nodes) {
      budget.step();
      const asynchronous = records.asyncFunction.get(target);
      if (asynchronous === undefined) continue;
      const sourceFuture = operation.asyncBody?.declaration === target ? operation.resultCarrier : asynchronous.futureCarrier;
      const topology = rustAwaitSelection(sourceFuture, definitions);
      const activation = storage.bindingsForInvocation(target, invocation, producer.bindings);
      if (topology === undefined || activation.kind !== "resolved") return undefined;
      const effects = effectsFor(target);
      let sourceWork = budget.metadata(asynchronous.futureCarrier);
      for (const error of effects.nativeErrors) sourceWork += budget.metadata(error.errorType);
      const replacementWork = budget.metadata(operation.targetGenericArguments);
      budget.expansion(sourceWork, replacementWork);
      const generics = callableValues.nativeStorage.genericBindingsFor(target, activation.bindings);
      if (generics.kind !== "resolved") return undefined;
      const substitutions = selection.bindingsFor(invocation, target,
        [asynchronous.futureCarrier, ...effects.nativeErrors.map(error => error.errorType)],
        { storageBindings: activation.bindings, genericBindings: generics.bindings });
      const edge = selection.edgeFor(target, "await", effects, substitutions);
      if (substitutions === undefined || edge === undefined) return undefined;
      budget.metadata(edge.effects);
      budget.metadata(edge.nativeErrors);
      for (const leaf of rustAwaitSelectionLeaves(topology)) {
        budget.step();
        if (leaf.future === undefined) continue;
        const carrier = substitutions.substitute(leaf.carrier);
        if (carrier === undefined) return undefined;
        const branch = branches.find(branch => rustTargetTypeRefEquals(branch, carrier));
        if (branch === undefined) return undefined;
        const value = Object.freeze({ invocation, carrier: snapshotClosedMetadata(branch), edge });
        const previous = selected.find(previous => previous.invocation === invocation &&
          previous.edge.declaration === target && rustTargetTypeRefEquals(previous.carrier, branch));
        if (previous === undefined) selected.push(value);
        else if (!rustSourceErrorEffectEdgeEquals(previous.edge, edge)) return undefined;
      }
    }
  }
  return storage.failureReason() === undefined ? Object.freeze(selected) : undefined;
}
