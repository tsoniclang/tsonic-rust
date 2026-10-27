import { createHash } from "node:crypto";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { closedMetadataEquals, closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustGenericCallableSignaturesMatch } from "../../../policy/conversions/generic-callable.js";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import type { RustGenericCallableStorageMember } from "../../../target-model/types/carriers/generic-callable-storage.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustGenericCallableEnvironment } from "./generic-environments.js";
import { type RustGenericCallableEnvironment } from "../../../target-model/records/generic-callables.js";
import type { RustNativeCaptureConstruction } from "../native/native-captures.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { RustNativeCallableInput } from "../../../target-model/records/native-protocols.js";
import type { RustNativeStorageSelection } from "../../../target-model/records/native-storage.js";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../target-model/records/generic-callables.js";
import { substituteRustTargetGenericArgument, substituteRustTargetGenerics, substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";

import { rustGenericCallableMemberBindings } from "./generic-bindings.js";
import { snapshotRustCallableBindings } from "../../../policy/types/callables/generic-bindings.js";
import type { RustPhysicalCallableSourceSelection } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";

import type { RustGenericCallablePhysicalMember, RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalSelection, RustGenericCallablePhysicalConversion } from "../../../target-model/records/generic-callables.js";

export type RustGenericCallablePhysicalCarrierSelector = (carrier: TargetTypeRef, ownerFileName: string,
  subject: SourceStorageSubject, bindings: SourceStorageBindings, producers: readonly SourceStorageProducer[]) =>
  { readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[];
    readonly sources: readonly RustPhysicalCallableSourceSelection[] } | undefined;

export interface RustGenericCallablePhysicalConstruction {
  readonly plan: RustGenericCallablePhysicalPlan;
  readonly carrierFor: RustGenericCallablePhysicalCarrierSelector;
  closeAdmission(): void;
  prepare(carrier: TargetTypeRef): void;
  prepareConversion(source: TargetTypeRef, target: TargetTypeRef): RustGenericCallablePhysicalConversion | undefined;
  closeKeys(): RustGenericCallablePhysicalPlan;
  publish(): void;
}

export interface RustGenericCallablePhysicalInput {
  readonly ast: AstReader;
  readonly lifetimes: RustLifetimeIndex;
  readonly storage: SourceStorageQueries;
  readonly captures: RustNativeCaptureConstruction;
  readonly native: Pick<RustNativeCallableInputPlan, "inputs">;
  readonly genericBindingsFor: RustNativeStoragePlan["genericBindingsFor"];
  readonly boundSubjectFor: (subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings) => RustNativeStorageSelection;
}

export function createRustGenericCallablePhysicalPlan(
  families: readonly RustGenericCallableDefinition[],
  familyFor: (carrier: TargetTypeRef) => RustGenericCallableDefinition | undefined,
  input: RustGenericCallablePhysicalInput,
): RustGenericCallablePhysicalConstruction {
  const implementations = new Map<Node, RustGenericCallableImplementation>();
  const origins = new Map<RustGenericCallableImplementation, RustGenericCallableStorageMember["origin"]>();
  const byOrigin = new Map<string, RustGenericCallableImplementation>();
  const environments = new Map<RustGenericCallableImplementation, RustGenericCallableEnvironment | undefined>();
  const activeEnvironments = new Set<RustGenericCallableImplementation>();
  const definitions = new Map<string, RustGenericCallablePhysicalDefinition>();
  let inventory: readonly RustGenericCallablePhysicalDefinition[] | undefined;
  let published = false;
  let closedKeys: RustGenericCallablePhysicalPlan | undefined;
  let closedSelection: ((carrier: TargetTypeRef) => RustGenericCallablePhysicalSelection | undefined) | undefined;
  let openCarriers: Map<string, RustGenericCallablePhysicalSelection> | undefined = new Map();
  const selectedCarriers: ReadonlyMap<string, RustGenericCallablePhysicalSelection> = openCarriers;
  const conversions = new Map<string, Map<string, RustGenericCallablePhysicalConversion | undefined>>();
  const nativeInputs = new Map(input.native.inputs.map(value => [value.implementation.identity, value]));
  const sourceFiles = new Set(input.storage.nodes.filter(node => input.ast.is.IsSourceFile(node)).map(node => input.ast.getFileName(input.ast.getSourceFile(node))));
  const usedNames = new Set(families.flatMap(family => [family.targetName,
    ...family.implementations.flatMap(value => [value.stateName, value.functionName, value.variantName])]));
  for (const family of families) for (const implementation of family.implementations) {
    implementations.set(implementation.declaration, implementation);
    const declarationIdentity = sourceNodeIdentity(input.ast, implementation.declaration);
    if (declarationIdentity === undefined) continue;
    const origin = Object.freeze({ fileName: implementation.sourceFileName, declarationIdentity });
    origins.set(implementation, origin);
    byOrigin.set(closedMetadataKey(origin), implementation);
  }
  const owned = (implementation: RustGenericCallableImplementation): boolean =>
    implementations.get(implementation.declaration) === implementation;
  const environmentFor = (implementation: RustGenericCallableImplementation): RustGenericCallableEnvironment | undefined =>
    owned(implementation) ? environments.get(implementation) : undefined;
  const constructEnvironment = (implementation: RustGenericCallableImplementation,
    required: boolean): RustGenericCallableEnvironment | undefined => {
    if (!owned(implementation)) return undefined;
    if (environments.has(implementation) || activeEnvironments.has(implementation)) return environments.get(implementation);
    activeEnvironments.add(implementation);
    try {
      const capture = required ? input.captures.require(implementation.declaration)
        : input.captures.forDeclaration(implementation.declaration);
      const selected = rustGenericCallableEnvironment(implementation, capture);
      const result = selected === undefined ? undefined : Object.freeze({ ...selected,
        substitutions: snapshotRustCallableBindings(selected.substitutions) });
      if (result !== undefined || required) environments.set(implementation, result);
      return result;
    } finally {
      activeEnvironments.delete(implementation);
    }
  };
  const select = (carrier: TargetTypeRef, mode: "admit" | "prepare" | "link" | "inspect"): RustGenericCallablePhysicalSelection | undefined => {
    if (closedSelection !== undefined) return closedSelection(carrier);
    const value = rustGenericCallableValue(carrier);
    const family = value === undefined ? undefined : familyFor(carrier);
    if (value === undefined || family === undefined) return undefined;
    const cacheKey = closedMetadataKey(carrier);
    const cached = selectedCarriers.get(cacheKey);
    if (cached !== undefined) return cached;
    const physical = value.physical;
    const members = physical?.members ?? family.implementations.map(implementation => ({
      origin: origins.get(implementation)!, arguments: [] as readonly number[],
    }));
    const actuals = physical?.arguments ?? [];
    const parameters: RustTargetGenericArgument[] = actuals.map((argument, index) => {
      const identity = `generic-callable:physical:${index}`;
      return argument.kind === "type"
        ? { kind: "type", type: { kind: "type-parameter", identity, name: `PhysicalType${index}` } }
        : argument.kind === "lifetime"
          ? { kind: "lifetime", lifetime: { kind: "parameter", identity, name: `physical${index}` } }
          : { kind: "const", value: { kind: "parameter", identity, name: `PhysicalConst${index}` } };
    });
    const selected: Omit<RustGenericCallablePhysicalMember, "bindings">[] = [];
    const variantNames = new Set<string>();
    for (const member of members) {
      if (member.origin === undefined) return undefined;
      const implementation = byOrigin.get(closedMetadataKey(member.origin));
      const environment = implementation === undefined ? undefined
        : mode === "admit" ? constructEnvironment(implementation, false) : environmentFor(implementation);
      if (implementation === undefined || environment === undefined || !family.implementations.includes(implementation) ||
        environment.parameters.length !== member.arguments.length ||
        environment.parameters.some((parameter, index) => parameter.kind !== parameters[member.arguments[index]!]!.kind)) return undefined;
      const arguments_ = member.arguments.map(index => parameters[index]!);
      selected.push(Object.freeze({ implementation, environment,
        variantName: allocateRustGeneratedName(variantNames, implementation.variantName), arguments: snapshotClosedMetadata(arguments_) }));
    }
    const ownerFileName = selected.length === 1 ? selected[0]!.implementation.sourceFileName
      : physical?.ownerFileName ?? family.ownerFileName;
    if (!sourceFiles.has(ownerFileName) || physical !== undefined && physical.ownerFileName !== ownerFileName) return undefined;
    const identity = closedMetadataKey({ family: family.identity, ownerFileName,
      members, parameters: parameters.map(parameter => parameter.kind) });
    let definition = definitions.get(identity);
    if (definition === undefined) {
      if (physical === undefined || mode === "inspect") return undefined;
      if (inventory !== undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A physical generic callable family was requested after family admission closed; its selected source root is missing.");
      if (mode === "link") failTargetAnalysisInvariant("tsonic-rust",
        "A physical generic callable shape was read before construction admitted its family; its selected source root is missing.");
      const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 12);
      const admitted = Object.freeze(selected.map(member => Object.freeze({ ...member,
        bindings: rustGenericCallableMemberBindings(family, member,
          { ast: input.ast, sourceLifetimes: input.lifetimes, physical: { environmentFor } }),
      })));
      definition = Object.freeze({ ...family, identity, familyIdentity: family.identity, ownerFileName,
        copy: selected.every(member => member.implementation.storage === "value"),
        targetName: allocateRustGeneratedName(usedNames, `GenericCallable${suffix}`),
        ...(family.nativeFutureDispatchName === undefined ? {} : {
          nativeFutureDispatchName: allocateRustGeneratedName(usedNames, `CallableFuture${suffix}`) }),
        implementations: Object.freeze(selected.map(member => member.implementation)),
        parameters: snapshotClosedMetadata(parameters), members: admitted,
        carrier: rustGenericCallableCarrier({ origin: family.origin, signature: family.signature,
          environment: family.signature.environmentParameters,
          physical: { ownerFileName, members, arguments: parameters } }),
      });
      definitions.set(identity, definition);
    }
    const result = Object.freeze({ definition, arguments: snapshotClosedMetadata(actuals) });
    if (mode === "admit" || mode === "prepare") openCarriers?.set(cacheKey, result);
    return result;
  };
  const prepareConversion = (source: TargetTypeRef, target: TargetTypeRef): RustGenericCallablePhysicalConversion | undefined => {
    if (closedKeys !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable conversions are prepared only before key closure.");
    const sourceKey = closedMetadataKey(source);
    const targetKey = closedMetadataKey(target);
    const existing = conversions.get(sourceKey);
    if (existing?.has(targetKey)) return existing.get(targetKey);
    const selected = selectConversion(source, target);
    if (selected === undefined && inventory === undefined) return undefined;
    const targets = existing ?? new Map<string, RustGenericCallablePhysicalConversion | undefined>();
    targets.set(targetKey, selected);
    conversions.set(sourceKey, targets);
    return selected;
  };
  const selectConversion = (source: TargetTypeRef, target: TargetTypeRef): RustGenericCallablePhysicalConversion | undefined => {
    if (!rustGenericCallableSignaturesMatch(source, target)) return undefined;
    const from = select(source, "prepare");
    const into = select(target, "prepare");
    if (from === undefined || into === undefined || from.definition.familyIdentity !== into.definition.familyIdentity) return undefined;
    if (from.definition === into.definition && closedMetadataEquals(from.arguments, into.arguments))
      return Object.freeze({ kind: "identity" as const });
    const sourceValue = rustGenericCallableValue(source)!;
    const targetValue = rustGenericCallableValue(target)!;
    const argumentsFor = (value: typeof sourceValue, index: number): readonly RustTargetGenericArgument[] =>
      value.physical?.members[index]!.arguments.map(argument => value.physical!.arguments[argument]!) ?? [];
    const transitions: { readonly source: RustGenericCallablePhysicalMember; readonly target: RustGenericCallablePhysicalMember }[] = [];
    for (const [index, member] of from.definition.members.entries()) {
      const arguments_ = argumentsFor(sourceValue, index);
      const candidate = into.definition.members.find((other, otherIndex) => other.implementation === member.implementation &&
        closedMetadataEquals(arguments_, argumentsFor(targetValue, otherIndex)));
      if (candidate === undefined) return undefined;
      transitions.push(Object.freeze({ source: member, target: candidate }));
    }
    return Object.freeze({ kind: "variants" as const, members: Object.freeze(transitions) });
  };
  const plan: RustGenericCallablePhysicalPlan = Object.freeze({
    definitions(): readonly RustGenericCallablePhysicalDefinition[] {
      if (inventory === undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical families are read only after their admission closes.");
      return inventory;
    },
    environmentFor,
    definitionFor: (carrier: TargetTypeRef) => select(carrier, "link")?.definition,
    argumentsFor: (carrier: TargetTypeRef) => select(carrier, "link")?.arguments,
    existingSelectionFor: (carrier: TargetTypeRef) => select(carrier, "inspect"),
    conversionFor: (source: TargetTypeRef, target: TargetTypeRef) => closedKeys === undefined
      ? prepareConversion(source, target) : closedKeys.conversionFor(source, target),
  });
  return Object.freeze({
    plan,
    carrierFor(carrier: TargetTypeRef, ownerFileName: string, subject: SourceStorageSubject,
      bindings: SourceStorageBindings, producers: readonly SourceStorageProducer[]) {
      if (!Array.isArray(producers)) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical selection requires its original source subject, bindings and producer vector.");
      if (closedKeys !== undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Generic callable physical construction cannot run after key closure.");
      const value = rustGenericCallableValue(carrier);
      const family = value === undefined ? undefined : familyFor(carrier);
      if (value === undefined || family === undefined || producers.length === 0) return undefined;
      if (input.storage.typeFor(subject).kind === "unresolved" ||
        input.storage.boundOriginsFor(subject, bindings).kind === "unresolved") return undefined;
      const members = new Map<string, { readonly member: RustGenericCallableStorageMember; readonly index: number }>();
      const producerMembers: { readonly producer: SourceStorageProducer; readonly index: number }[] = [];
      const arguments_: RustTargetGenericArgument[] = [];
      const argumentIndexes = new Map<string, number>();
      const selectedInputs = new Set<RustNativeCallableInput>();
      const nestedSources: RustPhysicalCallableSourceSelection[] = [];
      for (const producer of producers) {
        if (input.storage.boundOriginsFor(producer.subject, producer.bindings).kind === "unresolved") return undefined;
        if (producer.subject.projection.length !== 0) return undefined;
        const implementation = implementations.get(producer.subject.node);
        const environment = implementation === undefined ? undefined : constructEnvironment(implementation, false);
        const origin = implementation === undefined ? undefined : origins.get(implementation);
        const original = implementation === undefined ? undefined : rustGenericCallableValue(implementation.carrier);
        if (implementation === undefined || environment === undefined || origin === undefined || original === undefined ||
          !family.implementations.includes(implementation) || original.environment.length !== value.environment.length) return undefined;
        const substitutions = new Map(original.environment.flatMap((argument, index): [string, TargetTypeRef][] =>
          argument.kind === "type-parameter" ? [[argument.identity, value.environment[index]!]] : []));
        const owner = sourceEnclosingCallable(input.ast.parent(implementation.declaration), input.ast);
        const activation = owner === undefined ? undefined : input.genericBindingsFor(owner, producer.bindings);
        if (activation?.kind === "unresolved") return undefined;
        const memberArguments: RustTargetGenericArgument[] = [];
        for (const argument of environment.arguments) {
          if (argument.kind !== "type" || argument.type.kind !== "type-parameter") {
            memberArguments.push(activation === undefined ? argument : substituteRustTargetGenericArgument(argument,
              activation.bindings.types, activation.bindings.lifetimes, activation.bindings.consts));
            continue;
          }
          const selectedInput = nativeInputs.get(argument.type.identity);
          if (selectedInput === undefined) return undefined;
          const sourceCarrier = substituteRustTargetTypeParameters(selectedInput.carrier, substitutions);
          const carrier = activation === undefined ? sourceCarrier : substituteRustTargetGenerics(sourceCarrier,
            activation.bindings.types, activation.bindings.lifetimes, activation.bindings.consts);
          const selected = input.boundSubjectFor(selectedInput.subject,
            carrier, producer.bindings);
          if (selected.kind === "unresolved") return undefined;
          if (selected.kind === "selected") for (const sourceInput of selected.inputs) selectedInputs.add(sourceInput);
          for (const source of selected.sources) nestedSources.push(source);
          memberArguments.push(Object.freeze({ kind: "type", type: selected.carrier }));
        }
        const indexes = memberArguments.map(argument => {
          const key = closedMetadataKey(argument);
          const existing = argumentIndexes.get(key);
          if (existing !== undefined) return existing;
          const index = arguments_.length;
          argumentIndexes.set(key, index);
          arguments_.push(argument);
          return index;
        });
        const member = snapshotClosedMetadata({ origin, arguments: indexes });
        const key = closedMetadataKey(member);
        const existing = members.get(key);
        const index = existing?.index ?? members.size;
        if (existing === undefined) members.set(key, Object.freeze({ member, index }));
        producerMembers.push(Object.freeze({ producer, index }));
      }
      const selected = [...members.values()].map(value => value.member);
      const physicalOwner = selected.length === 1 ? selected[0]!.origin.fileName : ownerFileName;
      const result = rustGenericCallableCarrier({ ...value, physical: { ownerFileName: physicalOwner, members: selected, arguments: arguments_ } });
      const admitted = select(result, inventory === undefined ? "admit" : "prepare");
      if (admitted === undefined) return undefined;
      const sources: Extract<RustPhysicalCallableSourceSelection, { readonly kind: "complete" | "open" }>["producers"][number][] = [];
      for (const row of producerMembers) {
        const member = admitted.definition.members[row.index];
        if (member === undefined) return undefined;
        sources.push(Object.freeze({ producer: row.producer, member }));
      }
      return Object.freeze({ carrier: result, inputs: Object.freeze([...selectedInputs]),
        sources: Object.freeze([Object.freeze({ kind: "complete" as const, subject, bindings, producers: Object.freeze(sources) }),
          ...nestedSources]) });
    },
    closeAdmission(): void {
      if (inventory !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical family admission closes exactly once.");
      for (const family of families) for (const implementation of family.implementations) constructEnvironment(implementation, true);
      for (const definition of [...definitions.values()]) select(definition.carrier, "admit");
      inventory = Object.freeze([...definitions.values()]);
    },
    prepare(carrier: TargetTypeRef): void {
      if (inventory === undefined || closedKeys !== undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Generic callable keys are prepared after family admission and before key closure.");
      const visited = new Set<TargetTypeRef>();
      const visit = (current: TargetTypeRef): void => {
        if (visited.has(current)) return;
        visited.add(current);
        if (rustGenericCallableValue(current) !== undefined) select(current, "prepare");
        for (const child of rustTargetTypeChildren(current)) visit(child);
      };
      visit(carrier);
    },
    prepareConversion,
    closeKeys(): RustGenericCallablePhysicalPlan {
      if (inventory === undefined || closedKeys !== undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical keys close exactly once after family admission.");
      for (const definition of inventory) prepareConversion(definition.carrier, definition.carrier);
      closedKeys = createRustGenericCallablePhysicalRecords({ inventory, environments,
        selectedCarriers, conversions });
      closedSelection = closedKeys.existingSelectionFor;
      openCarriers = undefined;
      return closedKeys;
    },
    publish(): void {
      if (closedKeys === undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical families publish only after their keys close.");
      if (published) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical families publish exactly once.");
      published = true;
    },
  });
}

import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/generic-callables.js";
import { createRustGenericCallablePhysicalRecords } from "../../program/records/generic-callable-physical.js";
