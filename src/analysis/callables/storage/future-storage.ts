import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../../program/walk.js";

import type { RustFutureValueFact } from "../../../target-model/records/objects/object-methods.js";
import { rustFutureValueForOperation, rustFutureValueMatchesCarrier, rustNativeFutureValueForSourceCallBranch } from "../async/future-values.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustAwaitSelectionLeaves } from "../../../target-model/types/await.js";
import { rustAwaitSelection } from "../../../policy/operations/flow/await.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { RustSourceErrorBindings, RustSourceErrorEffectSelection } from "../../errors/source-error-effects.js";
import type { RustFinalizedValueConversion } from "../../../target-model/records/operations/finalized-operation.js";
import { finalizedConversionIsValid } from "../../../policy/operations/members/abi/conversions.js";
import { substituteRustValueConversion } from "../../../target-model/conversions/substitution.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustAwaitCarrier } from "../../../policy/operations/flow/await.js";

export function rustFutureValueForStoredBranch(
  walk: RustFactWalk,
  node: Node,
  branch: TargetTypeRef,
  rebind: RustSourceErrorEffectSelection,
): RustFutureValueFact | undefined {
  if (rustAwaitCarrier(branch) === undefined) return undefined;
  const { sourceStorage: storage, ast } = walk.context;
  const direct = futureForProducer(walk, node, branch);
  if (direct !== undefined) return direct;
  const subject = storage.subjectFor(node);
  const declaration = sourceEnclosingCallable(node, ast);
  const bindings = declaration === undefined ? storage.emptyBindings : walk.context.callableValues.native.bindingsFor(declaration);
  if (subject.kind !== "resolved" || bindings === undefined) return undefined;
  const sources = rustStoredFutureValues(walk, node, subject.subject, branch, bindings, rebind);
  if (sources === undefined) return undefined;
  let selected: RustFutureValueFact | undefined;
  for (const source of sources) {
    if (selected !== undefined && !closedMetadataEquals(selected, source.value)) return undefined;
    selected = source.value;
  }
  return selected;
}

export interface RustStoredFutureValue {
  readonly producer: SourceStorageProducer;
  readonly value: RustFutureValueFact;
}

export function rustStoredFutureValues(
  walk: RustFactWalk,
  node: Node,
  subject: SourceStorageSubject,
  branch: TargetTypeRef,
  bindings: SourceStorageBindings,
  rebind: RustSourceErrorEffectSelection,
): readonly RustStoredFutureValue[] | undefined {
  const { records, sourceStorage: storage, typeDefinitions: definitions, ast } = walk.context;
  const sources = storage.storageProducersFor(subject, bindings);
  if (sources.kind === "unresolved") return undefined;
  if (sources.kind === "open" && sources.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    !sources.producers.some(producer => producer.subject.node === boundary.exposure))) return undefined;
  if (sources.producers.length === 0) return undefined;
  const selected: RustStoredFutureValue[] = [];
  for (const source of sources.producers) {
    if (source.subject.kind !== "value" || source.subject.projection.length !== 0) return undefined;
    const producer = source.subject.node;
    const operation = records.targetOperation.get(producer);
    const topology = rustAwaitSelection(operation?.kind === "source-call" ? operation.resultCarrier
      : records.runtimeCarrier.get(producer)?.carrier, definitions);
    if (topology === undefined) return undefined;
    let candidate: RustFutureValueFact | undefined;
    for (const leaf of rustAwaitSelectionLeaves(topology)) {
      if (leaf.future === undefined) continue;
      const original = futureForProducer(walk, producer, leaf.carrier);
      const owner = sourceEnclosingCallable(producer, ast);
      if (original === undefined || owner === undefined) return undefined;
      const generics = walk.context.callableValues.nativeStorage.genericBindingsFor(owner, source.bindings);
      if (generics.kind !== "resolved") return undefined;
      const substitution = rebind.bindingsFor(node, owner, [leaf.carrier,
        ...(original.errorCarrier === undefined ? [] : [original.errorCarrier])],
        { storageBindings: source.bindings, genericBindings: generics.bindings });
      if (substitution === undefined) return undefined;
      const outputCarrier = substitution.substitute(original.outputCarrier);
      const awaitedConversion = substituteFutureConversion(original.awaitedConversion, substitution, definitions);
      if (outputCarrier === undefined || awaitedConversion === undefined) return undefined;
      let value: RustFutureValueFact = { ...original, outputCarrier, awaitedConversion };
      if (original.errorBoundary === "source-native") {
        if (original.errorCarrier === undefined || original.errorSource === undefined) return undefined;
        const edge = rebind.edgeFor(owner, "await", { localErrors: false, nativeErrors: [{
          identity: original.errorSource, errorType: original.errorCarrier,
        }] }, substitution);
        const channel = edge?.effects.nativeErrors[0];
        if (edge?.effects.nativeErrors.length !== 1 || channel === undefined) return undefined;
        value = { ...value, errorCarrier: channel.errorType, errorSource: channel.identity };
      } else if (original.errorCarrier !== undefined) {
        const errorCarrier = substitution.substitute(original.errorCarrier);
        if (errorCarrier === undefined) return undefined;
        value = { ...value, errorCarrier };
      }
      if (!rustFutureValueMatchesCarrier(value, branch, definitions)) continue;
      if (candidate !== undefined && !closedMetadataEquals(candidate, value)) return undefined;
      candidate = value;
    }
    if (candidate === undefined) {
      if (rustAwaitSelectionLeaves(topology).some(leaf => leaf.future !== undefined)) return undefined;
      continue;
    }
    selected.push(Object.freeze({ producer: source, value: candidate }));
  }
  return storage.failureReason() === undefined ? Object.freeze(selected) : undefined;
}

function substituteFutureConversion(
  conversion: RustFinalizedValueConversion,
  bindings: RustSourceErrorBindings,
  definitions: RustTypeDefinitions,
): RustFinalizedValueConversion | undefined {
  const sourceCarrier = bindings.substitute(conversion.sourceCarrier);
  const targetCarrier = bindings.substitute(conversion.targetCarrier);
  if (sourceCarrier === undefined || targetCarrier === undefined) return undefined;
  let selected: RustFinalizedValueConversion;
  if (conversion.kind === "sequence") {
    const steps = conversion.steps.map(step => substituteFutureConversion(step, bindings, definitions));
    if (!steps.every(step => step?.kind === "semantic")) return undefined;
    selected = { ...conversion, sourceCarrier, targetCarrier, steps };
  } else if (conversion.kind === "semantic") {
    selected = { ...conversion, sourceCarrier, targetCarrier, conversion: substituteRustValueConversion(
      conversion.conversion, bindings.types, bindings.lifetimes, bindings.consts) };
  } else selected = { ...conversion, sourceCarrier, targetCarrier };
  return finalizedConversionIsValid(selected, definitions) ? selected : undefined;
}

function futureForProducer(walk: RustFactWalk, producer: Node, branch: TargetTypeRef): RustFutureValueFact | undefined {
  const { records, typeDefinitions: definitions } = walk.context;
  const operation = records.targetOperation.get(producer);
  const effects = records.sourceCallEffects.get(producer);
  const native = rustNativeFutureValueForSourceCallBranch(operation, effects, branch, definitions);
  if (native !== undefined) return native;
  let infallible = false;
  if (operation?.kind === "source-call") {
    const owner = sourceEnclosingCallable(producer, walk.context.ast);
    const bindings = owner === undefined ? walk.context.sourceStorage.emptyBindings : walk.context.callableValues.native.bindingsFor(owner);
    if (bindings === undefined) return undefined;
    const implementations = walk.context.sourceStorage.invocationImplementationsFor(producer, bindings);
    if (implementations.kind !== "resolved" || !implementations.exact ||
      !implementations.nodes.some(declaration => records.asyncFunction.get(declaration) !== undefined)) return undefined;
    infallible = implementations.nodes.every(declaration => {
      const effects = records.sourceCallEffects.get(declaration);
      return records.asyncFunction.get(declaration) !== undefined && effects?.awaiting === "infallible";
    });
  }
  const selected = records.futureValue.get(producer) ??
    rustFutureValueForOperation(operation, effects, definitions, branch);
  if (selected === undefined || !rustFutureValueMatchesCarrier(selected, branch, definitions)) return undefined;
  return selected.errorBoundary === "source-program" && infallible
    ? { ...selected, awaiting: "infallible", errorBoundary: "none" } : selected;
}
