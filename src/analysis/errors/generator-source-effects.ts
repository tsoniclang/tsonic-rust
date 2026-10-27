import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustErrorEffectsFact } from "../../target-model/records/errors/error-effects.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/errors/source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals, type RustSourceErrorEffectSelection } from "./source-error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";

export function selectRustGeneratorSourceErrors(
  walk: RustFactWalk,
  receiver: Node,
  effectsFor: (declaration: Node) => RustErrorEffectsFact,
  selection: RustSourceErrorEffectSelection,
  budget: RustEffectsWorkBudget,
): RustSourceErrorEffectEdge | undefined {
  const { sourceStorage: storage, ast, records, callableValues } = walk.context;
  const subject = storage.subjectFor(receiver);
  const owner = sourceEnclosingCallable(receiver, ast);
  const bindings = owner === undefined ? storage.emptyBindings : callableValues.native.bindingsFor(owner);
  if (subject.kind !== "resolved" || bindings === undefined) return undefined;
  const producers = storage.storageProducersFor(subject.subject, bindings);
  if (producers.kind === "unresolved" || producers.producers.length === 0) return undefined;
  if (producers.kind === "open" && producers.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    !producers.producers.some(producer => producer.subject.node === boundary.exposure))) return undefined;
  let selected: RustSourceErrorEffectEdge | undefined;
  for (const producer of producers.producers) {
    budget.step();
    if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0) return undefined;
    const creation = producer.subject.node;
    const operation = records.targetOperation.get(creation);
    if (!ast.is.IsCallExpression(creation) || operation?.kind !== "source-call") return undefined;
    const implementations = storage.invocationImplementationsFor(creation, producer.bindings);
    if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length === 0) return undefined;
    for (const declaration of implementations.nodes) {
      budget.step();
      if (records.generator.get(declaration) === undefined) return undefined;
      const activation = storage.bindingsForInvocation(declaration, creation, producer.bindings);
      if (activation.kind !== "resolved") return undefined;
      const effects = effectsFor(declaration);
      for (const error of effects.nativeErrors) budget.metadata(error.errorType);
      const generics = effects.nativeErrors.length === 0 ? undefined
        : callableValues.nativeStorage.genericBindingsFor(declaration, activation.bindings);
      if (generics?.kind === "unresolved") return undefined;
      const substitutions = generics === undefined ? undefined : selection.bindingsFor(creation, declaration,
        effects.nativeErrors.map(error => error.errorType),
        { storageBindings: activation.bindings, genericBindings: generics.bindings });
      const edge = selection.edgeFor(declaration, "invoke", effects, substitutions);
      if (edge === undefined || selected !== undefined && !rustSourceErrorEffectEdgeEquals(selected, edge)) return undefined;
      selected = edge;
    }
  }
  return storage.failureReason() === undefined ? selected : undefined;
}
