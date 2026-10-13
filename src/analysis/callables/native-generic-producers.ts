import type { AstReader, Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataEquals, closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustPhysicalPayloadFor } from "../../target-model/types/physical-payloads.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustSourceCallEffectsFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustGenericCallablePhysicalDefinition } from "./generic-physical.js";
import type { RustNativeCallableInput, RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeCallableProtocol } from "./native-protocols.js";

export interface RustNativeGenericProducerBinding {
  readonly inputs: readonly RustNativeCallableInput[];
  readonly definition: RustGenericCallablePhysicalDefinition;
}

export interface RustNativeGenericProducerForwarding {
  readonly owner: Node;
  readonly input: RustNativeCallableInput;
  readonly trait: TargetTypeRef;
}

export interface RustNativeGenericProducerPlan {
  readonly bindings: readonly RustNativeGenericProducerBinding[];
  readonly open: readonly { readonly invocation: Node; readonly input: RustNativeCallableInput;
    readonly inputs: readonly RustNativeCallableInput[] }[];
  readonly unresolved: readonly { readonly invocation: Node; readonly input: RustNativeCallableInput; readonly reason: string }[];
  forProtocol(protocol: RustNativeCallableProtocol): readonly RustNativeGenericProducerBinding[];
  forwardingFor(owner: Node): readonly RustNativeGenericProducerForwarding[];
  errorAritiesFor(fileName: string): readonly number[] | undefined;
}

export function createRustNativeGenericProducerPlan(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly facts: RustPlanQueries;
  readonly generic: RustGenericCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly definitions: RustTypeDefinitions;
}): RustNativeGenericProducerPlan {
  const nativeInputs = new Map(input.native.inputs.map(selected => [selected.subject, selected]));
  const bindings = new Map<RustNativeCallableProtocol, Map<RustGenericCallablePhysicalDefinition, Set<RustNativeCallableInput>>>();
  const forwarding = new Map<Node, Map<string, RustNativeGenericProducerForwarding>>();
  const open: { readonly invocation: Node; readonly input: RustNativeCallableInput;
    readonly inputs: readonly RustNativeCallableInput[] }[] = [];
  const unresolved: { readonly invocation: Node; readonly input: RustNativeCallableInput; readonly reason: string }[] = [];
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
  for (const invocation of input.nodes) {
    const operation = input.facts.getFact(invocation, rustTargetOperationFactKey);
    const signature = operation?.kind === "source-call" ? input.facts.getSelectedTargetCall(invocation) : undefined;
    const declaration = signature?.sourceDeclaration;
    if (operation?.kind !== "source-call" || signature === undefined || declaration === undefined) continue;
    const owner = sourceEnclosingCallable(invocation, input.ast);
    for (const selected of input.native.inputsFor(declaration)) {
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
          const producer = input.facts.getFact(subject.node, rustTargetOperationFactKey);
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
  const byImplementation = new Map<Node, Set<RustGenericCallablePhysicalDefinition>>();
  for (const definition of input.generic.physical.definitions()) for (const member of definition.members) {
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
  const selectedForwarding = new Map([...forwarding].map(([owner, values]) => [owner, Object.freeze([...values.values()])]));
  const emptyBindings: readonly RustNativeGenericProducerBinding[] = Object.freeze([]);
  const emptyForwarding: readonly RustNativeGenericProducerForwarding[] = Object.freeze([]);
  return Object.freeze({ bindings: Object.freeze([...selectedBindings.values()].flat()), open: Object.freeze(open),
    unresolved: Object.freeze(unresolved),
    forProtocol: (protocol: RustNativeCallableProtocol) => selectedBindings.get(protocol) ?? emptyBindings,
    forwardingFor: (owner: Node) => selectedForwarding.get(owner) ?? emptyForwarding,
    errorAritiesFor(fileName: string): readonly number[] | undefined {
      const arities = new Set<number>();
      for (const definition of input.generic.physical.definitions()) {
        if (definition.ownerFileName !== fileName) continue;
        const effects = definition.implementations.map(implementation => input.facts.getFact(implementation.declaration, rustSourceCallEffectsFactKey));
        if (effects.some(effect => effect === undefined)) return undefined;
        for (const channel of ["invocation", "awaiting"] as const) {
          const arity = effects.filter(effect => effect?.[channel] === "fallible").length;
          if (arity > 1) arities.add(arity);
        }
      }
      return Object.freeze([...arities].sort((left, right) => left - right));
    },
  });
}
