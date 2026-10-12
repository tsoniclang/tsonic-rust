import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustFutureValueFactKey, rustSourceCallEffectsFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustFutureValueFact } from "../facts/keys.js";
import { rustFutureValueForOperation, rustFutureValueMatchesCarrier, rustNativeFutureValueForSourceCallBranch } from "../facts/future-values.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";

export function rustFutureValueForStoredBranch(
  walk: RustFactWalk,
  node: Node,
  branch: TargetTypeRef,
): RustFutureValueFact | undefined {
  const { facts, sourceStorage: storage, typeDefinitions: definitions, ast } = walk.context;
  const select = (producer: Node): RustFutureValueFact | undefined => {
    const operation = facts.get(producer, rustTargetOperationFactKey);
    const effects = facts.get(producer, rustSourceCallEffectsFactKey);
    const native = rustNativeFutureValueForSourceCallBranch(operation, effects, branch, definitions);
    const direct = native ?? facts.get(producer, rustFutureValueFactKey) ??
      rustFutureValueForOperation(operation, effects, definitions);
    return direct !== undefined && rustFutureValueMatchesCarrier(direct, branch, definitions) ? direct : undefined;
  };
  const direct = select(node);
  if (direct !== undefined) return direct;
  const subject = storage.subjectFor(node);
  const declaration = sourceEnclosingCallable(node, ast);
  const bindings = declaration === undefined ? storage.emptyBindings : walk.context.callableValues.native.bindingsFor(declaration);
  if (subject.kind !== "resolved" || bindings === undefined) return undefined;
  const sources = storage.storageProducersFor(subject.subject, bindings);
  if (sources.kind === "unresolved") return undefined;
  if (sources.kind === "open" && sources.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    select(boundary.exposure) === undefined)) return undefined;
  let selected: RustFutureValueFact | undefined;
  for (const source of sources.producers) {
    if (source.subject.kind !== "value" || source.subject.projection.length !== 0) return undefined;
    const producer = source.subject.node;
    const candidate = select(producer);
    if (candidate === undefined) {
      const topology = rustAwaitSelection(facts.getRuntimeCarrierFact(producer)?.carrier, definitions);
      if (topology === undefined || rustAwaitSelectionLeaves(topology).some(leaf => leaf.future !== undefined)) return undefined;
      continue;
    }
    if (selected !== undefined && !closedMetadataEquals(selected, candidate)) return undefined;
    selected = candidate;
  }
  return storage.failureReason() === undefined ? selected : undefined;
}
