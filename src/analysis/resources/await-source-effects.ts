import type { Node } from "@tsonic/tsts";
import { asSourceNode, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustAsyncFunctionFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustErrorEffectsFact } from "../facts/error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../facts/await-source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals } from "../facts/source-error-effects.js";
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
  const { sourceStorage: storage, ast, source, facts, callableValues, typeDefinitions: definitions } = walk.context;
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
    const operation = facts.get(invocation, rustTargetOperationFactKey);
    if (operation?.kind !== "source-call" || callableValues.native.callFor(invocation) !== undefined) continue;
    const signature = facts.getSelectedTargetCall(invocation);
    const declaration = asSourceNode(signature?.sourceDeclaration, ast);
    const implementation = declaration === undefined ? undefined : source.navigation.callableImplementation(declaration);
    if (implementation?.kind !== "resolved") return undefined;
    const target = implementation.implementation.declaration;
    if (facts.get(target, rustAsyncFunctionFactKey) === undefined) return undefined;
    const topology = rustAwaitSelection(operation.resultCarrier, definitions);
    const activation = storage.bindingsForInvocation(target, invocation, producer.bindings);
    if (topology === undefined || activation.kind !== "resolved") return undefined;
    const effects = effectsFor(target);
    let sourceWork = budget.metadata(operation.resultCarrier);
    for (const error of effects.nativeErrors) sourceWork += budget.metadata(error.errorType);
    const replacementWork = budget.metadata(operation.targetGenericArguments);
    budget.expansion(sourceWork, replacementWork);
    const substitutions = selection.bindingsFor(invocation, target,
      [operation.resultCarrier, ...effects.nativeErrors.map(error => error.errorType)], activation.bindings);
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
        rustTargetTypeRefEquals(previous.carrier, branch));
      if (previous === undefined) selected.push(value);
      else if (!rustSourceErrorEffectEdgeEquals(previous.edge, edge)) return undefined;
    }
  }
  return storage.failureReason() === undefined ? Object.freeze(selected) : undefined;
}
