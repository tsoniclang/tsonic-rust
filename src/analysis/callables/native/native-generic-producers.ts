import type { AstReader, Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

import { closedMetadataEquals, closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetGenericBindingsForArguments } from "../../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustCallableTargetId } from "../../../target-model/types/carriers/source-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustPhysicalPayloadFor } from "../../../policy/conversions/physical-payloads.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustGenericCallablePhysicalDefinition } from "../../../target-model/records/callables/generic-callables.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableInput } from "../../../target-model/records/native/native-protocols.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import type { RustNativeCallableProtocol } from "../../../target-model/records/native/native-protocols.js";

export function prepareRustNativeGenericProducerRequests(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly generic: RustGenericCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly definitions: RustTypeDefinitions;
}): RustNativeGenericProducerRequests {
  const nativeInputs = new Map(input.native.inputs.map(selected => [selected.subject, selected]));
  const bindings: { readonly input: RustNativeCallableInput; readonly definition: RustGenericCallablePhysicalDefinition }[] = [];
  const forwarding = new Map<Node, Map<string, RustNativeGenericProducerForwarding>>();
  const open: { readonly invocation: Node; readonly input: RustNativeCallableInput;
    readonly inputs: readonly RustNativeCallableInput[] }[] = [];
  const unresolved: { readonly invocation: Node; readonly input: RustNativeCallableInput; readonly reason: string }[] = [];
  const reject = (invocation: Node, selected: RustNativeCallableInput, reason: string): void => {
    unresolved.push(Object.freeze({ invocation, input: selected, reason }));
  };
  const bind = (selected: RustNativeCallableInput, definition: RustGenericCallablePhysicalDefinition): void => {
    bindings.push(Object.freeze({ input: selected, definition }));
  };
  for (const invocation of input.nodes) {
    const operation = input.records.targetOperation.get(invocation);
    const signature = operation?.kind === "source-call" ? input.records.selectedCall.get(invocation) : undefined;
    const declaration = signature?.sourceDeclaration;
    if (operation?.kind !== "source-call" || signature === undefined || declaration === undefined) continue;
    const owner = sourceEnclosingCallable(invocation, input.ast);
    // A call dispatched through a native callable input has no static implementation; a type-erased runtime
    // callable parameter of its signature is passed through unchanged, so it has no producer to forward.
    const dispatched = input.native.callFor(invocation) !== undefined;
    for (const selected of input.native.inputsFor(declaration)) {
      if (dispatched && isErasedRuntimeCallable(selected.carrier)) continue;
      const symbolic = input.nativeStorage.invocationOriginsFor(selected, invocation, owner);
      if (symbolic.kind === "unresolved") {
        reject(invocation, selected, symbolic.reason);
        continue;
      }
      const arguments_ = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
      if (arguments_ === undefined) {
        reject(invocation, selected, "Native generic producer forwarding requires exact selected generic arguments.");
        continue;
      }
      const trait = substituteRustTargetGenerics(selected.trait, arguments_.types, arguments_.lifetimes, arguments_.consts);
      for (const subject of symbolic.subjects) {
        const origin = nativeInputs.get(subject);
        if (origin === undefined || owner === undefined) continue;
        const values = forwarding.get(owner) ?? new Map<string, RustNativeGenericProducerForwarding>();
        values.set(`${origin.implementation.identity}:${closedMetadataKey(trait)}`, Object.freeze({ owner, input: origin, trait }));
        forwarding.set(owner, values);
      }
      const quantified = selected.protocol.signature.typeParameters.length > 0;
      const abstractInputs = new Set<RustNativeCallableInput>();
      let hasGenericProducer = false;
      for (const subject of symbolic.subjects) {
        const abstract = nativeInputs.get(subject);
        if (abstract !== undefined) {
          if (quantified) abstractInputs.add(abstract);
          continue;
        }
        const implementation = subject.projection.length === 0 ? input.generic.implementationFor(subject.node) : undefined;
        if (implementation === undefined) {
          const producer = input.records.targetOperation.get(subject.node);
          if (!quantified && !(producer?.kind === "closure" && rustGenericCallableValue(producer.resultCarrier) !== undefined)) continue;
          reject(invocation, selected, "An exact generic callable origin has no existing generic producer family.");
          continue;
        }
        hasGenericProducer = true;
      }
      if (hasGenericProducer) {
        const physical = input.nativeStorage.invocationInputFor(selected, invocation, owner);
        const payload = physical.kind === "unresolved" ? undefined : rustPhysicalPayloadFor(selected.carrier, physical.carrier,
          rustOptionElementCarrier(selected.carrier) ?? selected.carrier, input.definitions);
        const definition = payload === undefined ? undefined : input.generic.physical.definitionFor(payload);
        if (definition === undefined) {
          reject(invocation, selected, physical.kind === "unresolved" ? physical.reason
            : "An exact generic producer invocation lacks a selected physical family.");
          continue;
        }
        if (!closedMetadataEquals(definition.signature, selected.protocol.signature)) {
          reject(invocation, selected, "An exact generic producer family conflicts with its selected native protocol contract.");
          continue;
        }
        bind(selected, definition);
      }
      if (quantified && symbolic.subjects.length === 0)
        reject(invocation, selected, "A generic producer invocation has no proven concrete or symbolic origin.");
      if (abstractInputs.size > 0) open.push(Object.freeze({ invocation, input: selected,
        inputs: Object.freeze([...abstractInputs]) }));
    }
  }
  return Object.freeze({ bindings: Object.freeze(bindings),
    forwarding: new Map([...forwarding].map(([owner, values]) => [owner, Object.freeze([...values.values()])])),
    open: Object.freeze(open), unresolved: Object.freeze(unresolved) });
}

export function createRustNativeGenericProducerPlan(input: {
  readonly records: RustProgramRecords;
  readonly generic: RustGenericCallablePlan;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "implementationOriginsFor">;
  readonly requests: RustNativeGenericProducerRequests;
}): RustNativeGenericProducerPlan {
  const bindings = new Map<RustNativeCallableProtocol, Map<RustGenericCallablePhysicalDefinition, Set<RustNativeCallableInput>>>();
  const { open } = input.requests;
  const unresolved = [...input.requests.unresolved];
  const reject = (invocation: Node, selected: RustNativeCallableInput, reason: string): void => {
    unresolved.push(Object.freeze({ invocation, input: selected, reason }));
  };
  const bind = (selected: RustNativeCallableInput, definition: RustGenericCallablePhysicalDefinition): void => {
    const values = bindings.get(selected.protocol) ?? new Map<RustGenericCallablePhysicalDefinition, Set<RustNativeCallableInput>>();
    const consumers = values.get(definition) ?? new Set<RustNativeCallableInput>();
    consumers.add(selected);
    values.set(definition, consumers);
    bindings.set(selected.protocol, values);
  };
  for (const selected of input.requests.bindings) bind(selected.input, selected.definition);
  const inventory = input.generic.physical.definitions();
  const byImplementation = new Map<Node, Set<RustGenericCallablePhysicalDefinition>>();
  for (const definition of inventory) for (const member of definition.members) {
    const definitions = byImplementation.get(member.implementation.declaration) ?? new Set<RustGenericCallablePhysicalDefinition>();
    definitions.add(definition);
    byImplementation.set(member.implementation.declaration, definitions);
  }
  const reached = new Set(open.map(entry => entry.input));
  for (const selected of reached) {
    const origins = input.nativeStorage.implementationOriginsFor(selected);
    if (origins.kind === "unresolved") {
      for (const entry of open) if (entry.input === selected) reject(entry.invocation, selected, origins.reason);
      continue;
    }
    const implementations = new Set(origins.producers.flatMap(producer => {
      const implementation = producer.subject.projection.length === 0 ? input.generic.implementationFor(producer.subject.node) : undefined;
      return implementation === undefined ? [] : [implementation];
    }));
    const candidates = new Set([...implementations].flatMap(implementation =>
      [...byImplementation.get(implementation.declaration) ?? []]));
    for (const definition of candidates) {
      if (!definition.members.every(member => implementations.has(member.implementation))) continue;
      if (!closedMetadataEquals(definition.signature, selected.protocol.signature)) {
        for (const entry of open) if (entry.input === selected)
          reject(entry.invocation, selected, "An exact forwarded generic producer conflicts with its native protocol contract.");
        continue;
      }
      bind(selected, definition);
    }
  }
  const selectedBindings = new Map([...bindings].map(([protocol, values]) => [protocol, Object.freeze(
    [...values].map(([definition, inputs]) => Object.freeze({ definition, inputs: Object.freeze([...inputs]) })))]));
  const aritiesByFile = new Map<string, Set<number> | undefined>();
  for (const definition of inventory) {
    const file = definition.ownerFileName;
    if (!aritiesByFile.has(file)) aritiesByFile.set(file, new Set());
    const arities = aritiesByFile.get(file);
    if (arities === undefined) continue;
    const effects = definition.implementations.map(implementation => input.records.sourceCallEffects.get(implementation.declaration));
    if (effects.some(effect => effect === undefined)) {
      aritiesByFile.set(file, undefined);
      continue;
    }
    for (const channel of ["invocation", "awaiting"] as const) {
      const arity = effects.filter(effect => effect?.[channel] === "fallible").length;
      if (arity > 1) arities.add(arity);
    }
  }
  const errorArities = new Map([...aritiesByFile].map(([file, arities]) =>
    [file, arities === undefined ? undefined : Object.freeze([...arities].sort((left, right) => left - right))] as const));
  return sealRustNativeGenericProducers({ bindingsByProtocol: selectedBindings, open, unresolved,
    forwarding: input.requests.forwarding, errorArities });
}

import type { RustNativeGenericProducerForwarding, RustNativeGenericProducerPlan, RustNativeGenericProducerRequests } from "../../../target-model/records/native/native-generic-producers.js";
import { sealRustNativeGenericProducers } from "../../program/records/native/native-generic-producers.js";

function isErasedRuntimeCallable(carrier: TargetTypeRef): boolean {
  const selected = rustOptionElementCarrier(carrier) ?? carrier;
  return selected.kind === "target-named" && selected.id === rustCallableTargetId;
}
