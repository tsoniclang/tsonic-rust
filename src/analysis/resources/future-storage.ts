import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustAsyncFunctionFactKey, rustFutureValueFactKey, rustSourceCallEffectsFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustFutureValueFact } from "../facts/keys.js";
import { rustFutureValueForOperation, rustFutureValueMatchesCarrier, rustNativeFutureValueForSourceCallBranch } from "../facts/future-values.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { createRustSourceErrorEffectSelection, type RustSourceErrorBindings } from "./source-error-effects.js";
import type { RustFinalizedValueConversion } from "../facts/finalized-operation/model.js";
import { finalizedConversionIsValid } from "../facts/finalized-operation/conversions.js";
import { substituteRustValueConversion } from "../../target-model/conversions/substitution.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustAwaitCarrier } from "../../target-model/types/index.js";
import { rustErrorEffectsFactKey, rustErrorEffectsAreFallible } from "../facts/error-effects.js";

export function rustFutureValueForStoredBranch(
  walk: RustFactWalk,
  node: Node,
  branch: TargetTypeRef,
): RustFutureValueFact | undefined {
  if (rustAwaitCarrier(branch) === undefined) return undefined;
  const { sourceStorage: storage, ast } = walk.context;
  const direct = futureForProducer(walk, node, branch);
  if (direct !== undefined) return direct;
  const subject = storage.subjectFor(node);
  const declaration = sourceEnclosingCallable(node, ast);
  const bindings = declaration === undefined ? storage.emptyBindings : walk.context.callableValues.native.bindingsFor(declaration);
  if (subject.kind !== "resolved" || bindings === undefined) return undefined;
  const sources = rustStoredFutureValues(walk, node, subject.subject, branch, bindings);
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
): readonly RustStoredFutureValue[] | undefined {
  const { facts, sourceStorage: storage, typeDefinitions: definitions, ast } = walk.context;
  const sources = storage.storageProducersFor(subject, bindings);
  if (sources.kind === "unresolved") return undefined;
  if (sources.kind === "open" && sources.boundaries.some(boundary => boundary.kind !== "opaque-result" ||
    !sources.producers.some(producer => producer.subject.node === boundary.exposure))) return undefined;
  if (sources.producers.length === 0) return undefined;
  const selected: RustStoredFutureValue[] = [];
  const rebind = createRustSourceErrorEffectSelection(walk);
  for (const source of sources.producers) {
    if (source.subject.kind !== "value" || source.subject.projection.length !== 0) return undefined;
    const producer = source.subject.node;
    const operation = facts.get(producer, rustTargetOperationFactKey);
    const topology = rustAwaitSelection(operation?.kind === "source-call" ? operation.resultCarrier
      : facts.getRuntimeCarrierFact(producer)?.carrier, definitions);
    if (topology === undefined) return undefined;
    let candidate: RustFutureValueFact | undefined;
    for (const leaf of rustAwaitSelectionLeaves(topology)) {
      if (leaf.future === undefined) continue;
      const original = futureForProducer(walk, producer, leaf.carrier);
      const owner = sourceEnclosingCallable(producer, ast);
      if (original === undefined || owner === undefined) return undefined;
      const substitution = rebind.bindingsFor(node, owner, [leaf.carrier,
        ...(original.errorCarrier === undefined ? [] : [original.errorCarrier])], source.bindings);
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
  const { facts, typeDefinitions: definitions } = walk.context;
  const operation = facts.get(producer, rustTargetOperationFactKey);
  const effects = facts.get(producer, rustSourceCallEffectsFactKey);
  const native = rustNativeFutureValueForSourceCallBranch(operation, effects, branch, definitions);
  if (native !== undefined) return native;
  let infallible = false;
  if (operation?.kind === "source-call") {
    const owner = sourceEnclosingCallable(producer, walk.context.ast);
    const bindings = owner === undefined ? walk.context.sourceStorage.emptyBindings : walk.context.callableValues.native.bindingsFor(owner);
    if (bindings === undefined) return undefined;
    const implementations = walk.context.sourceStorage.invocationImplementationsFor(producer, bindings);
    if (implementations.kind !== "resolved" || !implementations.exact ||
      !implementations.nodes.some(declaration => facts.get(declaration, rustAsyncFunctionFactKey) !== undefined)) return undefined;
    infallible = implementations.nodes.every(declaration => {
      const effects = facts.get(declaration, rustErrorEffectsFactKey);
      return facts.get(declaration, rustAsyncFunctionFactKey) !== undefined && effects !== undefined && !rustErrorEffectsAreFallible(effects);
    });
  }
  const selected = facts.get(producer, rustFutureValueFactKey) ??
    rustFutureValueForOperation(operation, effects, definitions, branch);
  if (selected === undefined || !rustFutureValueMatchesCarrier(selected, branch, definitions)) return undefined;
  return selected.errorBoundary === "source-program" && infallible
    ? { ...selected, awaiting: "infallible", errorBoundary: "none" } : selected;
}
