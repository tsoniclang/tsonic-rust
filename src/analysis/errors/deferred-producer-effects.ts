import type { Node } from "@tsonic/tsts";
import { asSourceNode } from "@tsonic/target-api/source";

import type { RustDeferredProducerEffectsFact } from "../../target-model/records/deferred-producer-effects.js";
import { mergeRustDeferredProducerChannels } from "../callables/async/deferred-producer-effects.js";
import type { RustDeferredProducerChannel } from "../../target-model/records/deferred-producer-effects.js";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustNativeCallableCompletion } from "../../policy/types/callables/native-completion.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustStoredFutureValues, type RustStoredFutureValue } from "../callables/storage/future-storage.js";
import { createRustEffectsWorkBudget } from "./effects-work-budget.js";
import type { RustNativeCallableInput } from "../../target-model/records/native-protocols.js";
import { requireRustRecord } from "../program/records/required-records.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";

const infallible: TargetTypeRef = Object.freeze({ kind: "target-named", id: rustInfallibleTargetId });
const noFuture: RustDeferredProducerEffectsFact = Object.freeze({ kind: "no-future" });
const noFutureChannel: RustDeferredProducerChannel = Object.freeze({ awaiting: "infallible", errorCarrier: infallible });

export function recordRustDeferredProducerEffects(walk: RustFactWalk, sourceErrors: RustSourceErrorEffectSelection): void {
  walk.context.records.assertOpen();
  const { records, sourceStorage: storage, callableValues, typeDefinitions: definitions } = walk.context;
  const completed = new Map<Node, RustDeferredProducerEffectsFact>();
  const inputs = new Map(callableValues.native.inputs.map(input => [input.implementation.identity, input]));
  const budget = createRustEffectsWorkBudget();
  const failure = budget.run(() => {
    for (const producer of callableValues.nativeProducers.producers) {
      budget.step();
      const declaration = producer.declaration;
      if (records.asyncFunction.get(declaration) !== undefined) continue;
      const result = records.sourceCallableReturn.get(declaration);
      if (result === undefined) continue;
      if (result.implementationCompletion !== undefined) { completed.set(declaration, noFuture); continue; }
      budget.metadata(result.returnCarrier);
      const topology = rustAwaitSelection(result.returnCarrier, definitions);
      if (topology === undefined) continue;
      if (rustAwaitSelectionLeaves(topology).every(leaf => leaf.future === undefined)) {
        completed.set(declaration, noFuture);
        continue;
      }
      const completion = rustNativeCallableCompletion(result.returnCarrier, definitions);
      const subject = storage.subject(declaration, "return");
      const bindings = callableValues.native.bindingsFor(declaration);
      if (completion === undefined || subject.kind === "unresolved" || bindings === undefined) continue;
      const channels: RustDeferredProducerChannel[] = [];
      for (const future of completion.futures) {
        budget.step();
        const values = rustStoredFutureValues(walk, declaration, subject.subject, future.carrier, bindings, sourceErrors);
        if (values === undefined) break;
        const candidates: RustDeferredProducerChannel[] = values.length === 0 ? [noFutureChannel] : [];
        let exact = true;
        for (const value of values) {
          budget.step();
          const errorCarrier = errorForStoredFuture(walk, value, inputs);
          if (errorCarrier === undefined) {
            exact = false;
            break;
          }
          budget.metadata(errorCarrier);
          candidates.push({ awaiting: value.value.awaiting, errorCarrier });
        }
        const channel = exact ? mergeRustDeferredProducerChannels(candidates) : undefined;
        if (channel === undefined) break;
        channels.push(channel);
      }
      if (channels.length === completion.futures.length)
        completed.set(declaration, snapshotClosedMetadata({ kind: "futures", channels }));
    }
  });
  if (failure !== undefined) {
    const subject = callableValues.nativeProducers.producers[0]?.declaration ?? walk.context.sourceFiles[0];
    if (subject !== undefined) appendRustDiagnostic(walk, failure.code, failure.message, subject,
      ["target.capability=rust.async.exact-deferred-producer"]);
    return;
  }
  for (const [declaration, selected] of completed) {
    requireRustRecord(walk.context.requiredRecords, "deferredProducerEffects", declaration,
      selected.kind, "recordRustDeferredProducerEffects");
  }
  records.deferredProducerChannels.finalize(completed);
}

function errorForStoredFuture(walk: RustFactWalk, selected: RustStoredFutureValue,
  inputs: ReadonlyMap<string, RustNativeCallableInput>): TargetTypeRef | undefined {
  const { value } = selected;
  if (value.awaiting === "infallible") return infallible;
  if (value.errorBoundary === "provider-native" || value.errorBoundary === "source-native") return value.errorCarrier;
  if (value.errorBoundary === "target-runtime") return rustRuntimeErrorTargetType();
  if (value.errorBoundary === "js-rejection") return rustJsValueTargetType();
  if (value.errorBoundary !== "source-program") return undefined;
  const { records, ast, source, sourceStorage: storage, callableValues, typeDefinitions: definitions } = walk.context;
  const node = selected.producer.subject.node;
  const operation = records.targetOperation.get(node);
  const signature = records.selectedCall.get(node);
  const declaration = asSourceNode(signature?.sourceDeclaration, ast);
  const implementation = declaration === undefined ? undefined : source.navigation.callableImplementation(declaration);
  if (operation?.kind !== "source-call" || signature === undefined || implementation?.kind !== "resolved") return undefined;
  const owner = implementation.implementation.declaration;
  const asynchronous = records.asyncFunction.get(owner);
  const producer = callableValues.nativeProducers.forDeclaration(owner);
  const arguments_ = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
  if (asynchronous === undefined || producer === undefined || arguments_ === undefined) return undefined;
  const completion = rustNativeCallableCompletion(asynchronous.futureCarrier, definitions);
  const future = completion?.futures.find(candidate => rustTargetTypeRefEquals(
    substituteRustTargetGenerics(candidate.output, arguments_.types, arguments_.lifetimes, arguments_.consts), value.outputCarrier));
  const error = future === undefined ? undefined : callableValues.nativeProducers.errorFor(owner, future.ordinal);
  const activation = storage.bindingsForInvocation(owner, node, selected.producer.bindings);
  if (error === undefined || activation.kind !== "resolved") return undefined;
  const types = new Map(arguments_.types);
  for (const parameter of producer.environment) {
    if (parameter.kind !== "type" || parameter.type.kind !== "type-parameter") continue;
    const input = inputs.get(parameter.type.identity);
    if (input === undefined) continue;
    const carrier = substituteRustTargetGenerics(input.carrier, arguments_.types, arguments_.lifetimes, arguments_.consts);
    const physical = callableValues.nativeStorage.boundSubjectFor(input.subject, carrier, activation.bindings);
    if (physical.kind === "unresolved") return undefined;
    types.set(parameter.type.identity, physical.carrier);
  }
  return substituteRustTargetGenerics(error, types, arguments_.lifetimes, arguments_.consts);
}
