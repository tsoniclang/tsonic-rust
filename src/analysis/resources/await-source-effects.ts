import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";


import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../../target-model/records/await-source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals } from "../errors/source-error-effects.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";

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
    if (operation?.kind !== "source-call" || callableValues.native.callFor(invocation) !== undefined) continue;
    const implementations = storage.invocationImplementationsFor(invocation, producer.bindings);
    if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length === 0) return undefined;
    for (const target of implementations.nodes) {
      budget.step();
      const asynchronous = records.asyncFunction.get(target);
      if (asynchronous === undefined) continue;
      const topology = rustAwaitSelection(asynchronous.futureCarrier, definitions);
      const activation = storage.bindingsForInvocation(target, invocation, producer.bindings);
      if (topology === undefined || activation.kind !== "resolved") return undefined;
      const effects = effectsFor(target);
      let sourceWork = budget.metadata(asynchronous.futureCarrier);
      for (const error of effects.nativeErrors) sourceWork += budget.metadata(error.errorType);
      const replacementWork = budget.metadata(operation.targetGenericArguments);
      budget.expansion(sourceWork, replacementWork);
      const substitutions = selection.bindingsFor(invocation, target,
        [asynchronous.futureCarrier, ...effects.nativeErrors.map(error => error.errorType)], activation.bindings);
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
