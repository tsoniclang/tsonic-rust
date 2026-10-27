import { structuralStorageKey, instantiateStructuralDefinition } from "../../../policy/types/objects/structural-storage.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { preferredShapeName, allocateSnakeName, allocatePascalName } from "../../names/structural-storage.js";
import type { RustStructuralShapeField, RustStructuralShapeDefinition, RustStructuralMethodStorageSelection, RustStructuralMethodExposure, RustStructuralMethodPlan } from "../../../target-model/records/objects/structural-shapes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { SourceStructuralMember } from "@tsonic/target-api/source";
import type { RustNativeCallableInput } from "../../../target-model/records/native/native-protocols.js";

import { rustPropertyStorageNames } from "../../../target-model/names/property-storage.js";
import type { RustStructuralInstantiation } from "../../../target-model/records/types/source-types.js";
import { createRustGeneratedUnionPlan, type RustGeneratedUnionPlan } from "./generated-union-plan.js";
import type { RustNativeObjectField } from "../../../target-model/operations/native-memory.js";
import { rustNativeMemoryLayoutsEqual } from "../../../target-model/operations/native-memory.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { rustStructuralObjectCarrierValue, rustTargetGenericReferences, rustOptionElementCarrier, rustOptionTargetType, rustCallableProtocol, rustCallableTargetType, rustProgramErrorTargetType, rustNamedTypeCarrierValue } from "../../../target-model/types/index.js";
import { rustStructuralMethodStorageCarrier } from "../../../policy/types/objects/member-storage.js";
import { rustRuntimeRecordFieldTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";

import { rustStructuralGenericCarrier } from "../../../policy/types/objects/structural-generics.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { RustSourceObjectShape, RustStructuralFieldImplementation } from "../../../target-model/records/types/source-types.js";
import { selectRustStructuralMethodContextCarrier } from "../../../policy/types/objects/structural-emission.js";
import { selectRustStructuralPhysicalDestinations } from "./physical-destinations.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";


type RustStructuralMethodLayout = Exclude<RustStructuralMethodPlan, { readonly kind: "fixed" }> |
  Omit<Extract<RustStructuralMethodPlan, { readonly kind: "fixed" }>, "payload" | "factoryReceiver" | "context">;
export type RustStructuralShapeLayout = RustStructuralShapeDefinition<RustStructuralMethodLayout>;
export type RustStructuralPhysicalCarrierSelection =
  | { readonly kind: "resolved"; readonly carrier: TargetTypeRef }
  | { readonly kind: "unresolved"; readonly reason: string };
export type RustStructuralPhysicalCompletionEvidence =
  | { readonly kind: "instance" }
  | { readonly kind: "native-input"; readonly owner: RustNativeCallableInput["owner"];
      readonly subject: SourceStorageSubject; readonly fields: readonly {
        readonly sourceName: string; readonly member: SourceStructuralMember;
        readonly subject: SourceStorageSubject; readonly carrier: TargetTypeRef;
        readonly inputs: readonly RustNativeCallableInput[];
      }[] };

interface RustStructuralCarrierRegistration {
  readonly definition: RustStructuralShapeLayout;
  readonly completion: { readonly kind: "source" } | { readonly kind: "physical"; readonly carrier: TargetTypeRef };
}

export interface RustStructuralShapePlan<MethodPlan = RustStructuralMethodPlan> extends RustGeneratedUnionPlan {
  readonly definitions: readonly RustStructuralShapeDefinition<MethodPlan>[];
  readonly instances: readonly RustStructuralShapeDefinition<MethodPlan>[];
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition<MethodPlan> | undefined;
  templateForCarrier(carrier: TargetTypeRef): RustStructuralShapeDefinition<MethodPlan> | undefined;
  sharesStorage(left: TargetTypeRef, right: TargetTypeRef): boolean;
  fieldName(carrier: TargetTypeRef, storageIndex: number): string | undefined;
  field(carrier: TargetTypeRef, storageIndex: number): RustStructuralShapeField<MethodPlan> | undefined;
}

export type RustStructuralShapeLayoutPlan = RustStructuralShapePlan<RustStructuralMethodLayout>;

export function createRustStructuralShapePlan(
  shapes: readonly RustSourceObjectShape[],
  implementations: readonly RustStructuralFieldImplementation[],
  componentForFile: (fileName: string) => string,
  nativeFields: readonly RustNativeObjectField[],
  methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
  instantiations: readonly RustStructuralInstantiation[] = [],
  unions: RustGeneratedUnionPlan = createRustGeneratedUnionPlan([], componentForFile, new Map()),
  receiverIndependentMethods: ReadonlySet<string> = new Set(),
): RustStructuralShapeLayoutPlan {
  return createRustStructuralShapeConstruction(shapes, implementations, componentForFile, nativeFields,
    instantiations, unions, methodExposures, receiverIndependentMethods).plan;
}

export function createRustStructuralShapeConstruction(
  shapes: readonly RustSourceObjectShape[],
  implementations: readonly RustStructuralFieldImplementation[],
  componentForFile: (fileName: string) => string,
  nativeFields: readonly RustNativeObjectField[],
  instantiations: readonly RustStructuralInstantiation[],
  unions: RustGeneratedUnionPlan,
  methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
  receiverIndependentMethods: ReadonlySet<string>,
): {
  readonly plan: RustStructuralShapeLayoutPlan;
  completed(): RustStructuralShapePlan;
  methodStorageFinalized(): boolean;
  close(): RustStructuralShapePlan;
  completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef,
    evidence: RustStructuralPhysicalCompletionEvidence): RustStructuralPhysicalCarrierSelection;
  instantiateSourceCarrier(source: TargetTypeRef, instance: TargetTypeRef): RustStructuralPhysicalCarrierSelection;
  finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeLayout,
    ReadonlyMap<number, RustStructuralMethodStorageSelection>>, errorForFile: (fileName: string) => TargetTypeRef | undefined): void;
} {
  const selections = new Map<TargetTypeRef, ReturnType<typeof rustStructuralGenericCarrier>>();
  const physicalSelection = (carrier: TargetTypeRef): ReturnType<typeof rustStructuralGenericCarrier> => {
    const existing = selections.get(carrier);
    if (existing !== undefined) return existing;
    const selected = rustStructuralGenericCarrier(carrier, "fields");
    selections.set(carrier, selected);
    return selected;
  };
  const physicalKey = (carrier: TargetTypeRef): string =>
    structuralStorageKey(physicalSelection(carrier).carrier, componentForFile);
  const uniqueByKey = new Map<string, Map<string, TargetTypeRef>>();
  for (const carrier of [...shapes.map(shape => shape.carrier), ...instantiations.map(instantiation => instantiation.instance)]) {
    const structural = rustStructuralObjectCarrierValue(carrier);
    if (structural === undefined) {
      continue;
    }
    const key = physicalKey(carrier);
    const instances = uniqueByKey.get(key) ?? new Map<string, TargetTypeRef>();
    uniqueByKey.set(key, instances);
    const instanceKey = closedMetadataKey(carrier);
    const existing = instances.get(instanceKey);
    if (existing === undefined) {
      instances.set(instanceKey, carrier);
    } else if (!rustTargetTypeRefEquals(existing, carrier)) {
      throw new Error("Rust structural carrier canonicalization produced a non-injective identity.");
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const { template, instance } of instantiations) {
    const templateKey = physicalKey(template);
    const instanceKey = physicalKey(instance);
    if (templateKey === instanceKey) continue;
    const selected = parents.get(instanceKey) ?? new Set<string>();
    selected.add(templateKey);
    parents.set(instanceKey, selected);
  }
  const carrierByKey = new Map<string, TargetTypeRef>();
  for (const carrier of [...shapes.map(shape => shape.carrier), ...instantiations.flatMap(entry => [entry.template, entry.instance])]) {
    if (rustStructuralObjectCarrierValue(carrier) === undefined) continue;
    const key = physicalKey(carrier);
    if (!carrierByKey.has(key)) carrierByKey.set(key, physicalSelection(carrier).carrier);
  }
  // Two storage roots for one instance are one storage when one root is a generic instantiation of the other, closed
  // root (a generic object literal shape and an authored concrete type with the same layout): the generic root owns the
  // storage. Two open roots without an edge between them stay contradictory.
  const generalizes = (general: string, specific: string): boolean => {
    const generalCarrier = carrierByKey.get(general);
    const specificCarrier = carrierByKey.get(specific);
    if (generalCarrier === undefined || specificCarrier === undefined ||
      rustTargetGenericReferences(specificCarrier).typeIdentities.length !== 0) return false;
    const typeIdentities = new Set(rustTargetGenericReferences(generalCarrier).typeIdentities);
    return typeIdentities.size !== 0 && inferRustTargetGenericBindings(generalCarrier, specificCarrier,
      { typeIdentities, lifetimeIdentities: new Set(), constIdentities: new Set() }) !== undefined;
  };
  const roots = new Map<string, string>();
  const resolving = new Set<string>();
  const rootFor = (key: string): string => {
    const existing = roots.get(key);
    if (existing !== undefined) return existing;
    if (resolving.has(key)) throw new Error("Rust structural instantiation has cyclic storage templates.");
    resolving.add(key);
    let root: string | undefined;
    for (const parent of parents.get(key) ?? []) {
      const selected = rootFor(parent);
      if (root !== undefined && root !== selected) {
        if (generalizes(selected, root)) { root = selected; continue; }
        if (generalizes(root, selected)) continue;
        throw new Error("Rust structural instantiation has contradictory storage templates.");
      }
      root = selected;
    }
    resolving.delete(key);
    roots.set(key, root ?? key);
    return root ?? key;
  };
  const grouped = new Map<string, Map<string, TargetTypeRef>>();
  for (const [key, instances] of uniqueByKey) {
    const root = rootFor(key);
    if (!uniqueByKey.has(root)) throw new Error("Rust structural instantiation is missing its declared storage template.");
    const group = grouped.get(root) ?? new Map<string, TargetTypeRef>();
    grouped.set(root, group);
    for (const [instanceKey, carrier] of instances) group.set(instanceKey, carrier);
  }
  const usedTypeNamesByComponent = new Map<string, Set<string>>();
  const nestedCarriers: { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef }[] = [];
  let definitions: readonly RustStructuralShapeLayout[] = Object.freeze([...grouped]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, instances]): RustStructuralShapeLayout => {
      const sourceCarriers = Object.freeze([...instances]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, carrier]) => carrier));
      const original = [...uniqueByKey.get(key)!]
        .sort(([left], [right]) => left.localeCompare(right, "en"))[0]![1];
      const nativeDispatch = rustStructuralObjectCarrierValue(original)?.construction !== undefined ||
        implementations.some(implementation => implementation.kind === "dispatch" && instances.has(closedMetadataKey(implementation.carrier)));
      const selection = nativeDispatch ? rustStructuralGenericCarrier(original, "dispatch") : physicalSelection(original);
      const carrier = selection.carrier;
      for (const source of sourceCarriers) nestedCarriers.push(...(nativeDispatch
        ? rustStructuralGenericCarrier(source, "dispatch") : physicalSelection(source)).nestedCarriers);
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural === undefined) {
        throw new Error("Rust structural shape plan contains a non-structural carrier.");
      }
      const componentId = componentForFile(structural.ownerFileName);
      const usedTypeNames = usedTypeNamesByComponent.get(componentId) ?? new Set<string>();
      usedTypeNamesByComponent.set(componentId, usedTypeNames);
      const fieldNames = rustPropertyStorageNames(structural.fields.map(field => field.sourceName));
      const usedFieldNames = new Set(fieldNames.values());
      const fields = structural.fields.map((field, storageIndex): RustStructuralShapeField<RustStructuralMethodLayout> => {
        const selectedNativeFields = nativeFields.filter(candidate => candidate.storageIndex === storageIndex &&
          instances.has(closedMetadataKey(candidate.owner)));
        const nativeLayout = selectedNativeFields[0]?.layout;
        if (nativeLayout !== undefined && selectedNativeFields.some(candidate =>
          !rustNativeMemoryLayoutsEqual(candidate.layout, nativeLayout))) {
          throw new Error("Equivalent Rust structural carriers have contradictory native field layouts.");
        }
        const targetName = fieldNames.get(field.sourceName)!;
        const fieldImplementations = implementations.filter((implementation) =>
          implementation.storageIndex === storageIndex &&
          instances.has(closedMetadataKey(implementation.carrier)));
        const propertyStorage = field.accessor !== undefined ||
          fieldImplementations.some((implementation) => implementation.kind === "accessor" || implementation.kind === "dispatch" && field.method !== true);
        const independent = sourceCarriers.some(source =>
          receiverIndependentMethods.has(`${structuralStorageKey(source, componentForFile)}#${storageIndex}`));
        const methodStorageCarrier = field.method !== true ? undefined : independent ? field.type
          : rustStructuralMethodStorageCarrier(carrier, field.type, field.presence);
        const exposure = field.method !== true ? undefined : methodExposures.get(`${key}#${storageIndex}`);
        if (field.method === true && (methodStorageCarrier === undefined || exposure === undefined))
          throw new Error("A structural method requires its complete selected native exposure and signature.");
        const methodPlan: RustStructuralMethodLayout | undefined = methodStorageCarrier === undefined || exposure === undefined
          ? undefined : Object.freeze({ carrier: methodStorageCarrier, constructions: Object.freeze([]),
            receiver: independent ? "independent" as const : "included" as const,
            ...(nativeDispatch ? exposure.kind === "fixed"
              ? { kind: "native-dispatch" as const, implementation: "fixed" as const, declaration: exposure.declaration }
              : { kind: "native-dispatch" as const, implementation: "stored" as const }
              : exposure.kind === "fixed" ? { kind: "fixed" as const, declaration: exposure.declaration }
                : { kind: "stored" as const }) });
        return Object.freeze({
          ...(nativeLayout === undefined ? {} : { nativeLayout }),
          sourceName: field.sourceName,
          targetName,
          carrier: field.type,
          presence: field.presence,
          readonly: field.readonly,
          storage: field.bound === true ? "bound" as const : propertyStorage ? "property" as const : "stored" as const,
          ...(field.bound === true ? { boundStorage: Object.freeze({ carrier: rustRuntimeRecordFieldTargetType(field.type, rustProgramErrorTargetType()),
            direct: structural.representation === "value" }) } : {}),
          ...(!propertyStorage
            ? {}
            : {
                property: Object.freeze({
                  selfMode: field.accessor !== undefined || fieldImplementations.some(implementation => implementation.kind === "accessor")
                    ? "rc" as const : "ref" as const,
                  getterTargetName: allocateSnakeName(
                    usedFieldNames,
                    `get_${field.sourceName}`,
                  ),
                  ...(!field.readonly
                    ? {
                        setterTargetName: allocateSnakeName(
                          usedFieldNames,
                          `set_${field.sourceName}`,
                        ),
                      }
                    : {}),
                }),
              }),
          ...(field.method === true ? { method: true as const } : {}),
          ...(methodPlan === undefined ? {} : { methodPlan }),
        });
      });
      const genericReferences = rustTargetGenericReferences(carrier);
      if (genericReferences.constIdentities.length !== 0 ||
        genericReferences.lifetimes.some((lifetime) => lifetime.kind !== "parameter")) {
        throw new Error("Rust structural source shapes cannot capture const or higher-ranked generic parameters.");
      }
      const targetName = allocatePascalName(usedTypeNames, preferredShapeName(fields));
      return Object.freeze({
        carrier,
        sourceCarriers,
        ownerFileName: structural.ownerFileName,
        componentId,
        targetName,
        ...(!nativeDispatch ? {} : {
          dispatchName: allocatePascalName(usedTypeNames, `${targetName}Dispatch`),
        }),
        dispatchLifetime: selection.dispatchLifetime,
        genericParameters: Object.freeze([
          ...genericReferences.lifetimes.map((lifetime) => Object.freeze({
            kind: "lifetime" as const,
            lifetime: lifetime as Extract<RustLifetimeRef, { readonly kind: "parameter" }>,
          })),
          ...genericReferences.typeParameters.map((parameter) => Object.freeze({
            kind: "type" as const,
            identity: parameter.identity,
            name: parameter.name,
          })),
        ]),
        genericArguments: Object.freeze([
          ...genericReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...genericReferences.typeParameters.map(type => ({ kind: "type" as const, type })),
        ]),
        stateGenericParameters: Object.freeze([
          ...genericReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const,
            lifetime: lifetime as Extract<RustLifetimeRef, { readonly kind: "parameter" }> })),
          ...genericReferences.typeParameters.map(parameter => ({ kind: "type" as const, identity: parameter.identity, name: parameter.name })),
        ]),
        stateGenericArguments: Object.freeze([
          ...genericReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...genericReferences.typeParameters.map(type => ({ kind: "type" as const, type })),
        ]),
        contextMarker: undefined,
        contextConstructor: undefined,
        fields: Object.freeze(fields),
        ...(structural.construction === undefined ? {} : { construction: Object.freeze({
          targetName: allocateSnakeName(usedFieldNames, "construct"), carrier: structural.construction,
        }) }),
      });
    }));
  const byKey = new Map<string, RustStructuralCarrierRegistration>();
  const byStorageKey = new Map<string, RustStructuralShapeLayout>();
  const originsByKey = new Map<string, RustStructuralShapeLayout>();
  const registerCarrier = (definition: RustStructuralShapeLayout, carrier: TargetTypeRef,
    origin: RustStructuralShapeLayout): RustStructuralShapeLayout => {
    const key = closedMetadataKey(carrier);
    const existing = byKey.get(key);
    if (existing !== undefined && (existing.definition.targetName !== definition.targetName ||
      existing.definition.componentId !== definition.componentId)) {
      throw new Error("Rust structural storage has conflicting canonical template identities.");
    }
    if (existing !== undefined) return existing.definition;
    const selected = instantiateStructuralDefinition(definition, carrier);
    if (selected === undefined) throw new Error("Rust structural storage requires an exact generic-parameter correspondence.");
    byKey.set(key, Object.freeze({ definition: selected, completion: Object.freeze({ kind: "source" }) }));
    const storageKey = structuralStorageKey(carrier, componentForFile);
    const storage = byStorageKey.get(storageKey);
    if (storage !== undefined && (storage.targetName !== definition.targetName || storage.componentId !== definition.componentId)) {
      throw new Error("Rust structural storage has conflicting canonical template identities.");
    }
    byStorageKey.set(storageKey, origin);
    originsByKey.set(key, origin);
    return selected;
  };
  for (const definition of definitions) {
    for (const carrier of definition.sourceCarriers) registerCarrier(definition, carrier, definition);
    registerCarrier(definition, definition.carrier, definition);
  }
  for (const nested of nestedCarriers) {
    const definition = originsByKey.get(closedMetadataKey(nested.source));
    if (definition === undefined) {
      throw new Error("Nested Rust structural storage is missing its checked source definition.");
    }
    registerCarrier(definition, nested.carrier, definition);
  }
  let publishedInstances = Object.freeze([...byKey.values()].map(value => value.definition));
  let closed = false;
  let methodStorageFinalized = false;
  let normalizeCompletionCarrier = (carrier: TargetTypeRef): TargetTypeRef => carrier;
  const completedCarriers = new Map<RustStructuralShapeLayout, Map<string,
    { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef; readonly template: RustStructuralShapeLayout;
      readonly inputs: readonly RustNativeCallableInput[] }>>();
  const physicalTemplateFor = (definition: RustStructuralShapeLayout): RustStructuralShapeLayout | undefined => {
    const completed = completedCarriers.get(definition);
    const values = [...(completed?.values() ?? [])];
    return [definition, ...values.map(value => value.template)].find(template => values.length !== 0 && values.every(value =>
      instantiateStructuralDefinition(template, value.carrier) !== undefined));
  };
  let completedPlan: RustStructuralShapePlan | undefined;
  let completeFinalPhysical: ((source: TargetTypeRef, physical: TargetTypeRef,
    evidence: RustStructuralPhysicalCompletionEvidence) => RustStructuralPhysicalCarrierSelection) | undefined;
  const definitionFor = (carrier: TargetTypeRef | undefined): RustStructuralShapeLayout | undefined => {
    if (completedPlan !== undefined) return completedPlan.definitionForCarrier(carrier);
    if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) return undefined;
    const key = closedMetadataKey(carrier);
    const registered = byKey.get(key);
    if (registered !== undefined) return registered.definition;
    if (closed) return undefined;
    // A generic callable family instantiates a shape over its own environment parameters (the receiver of a generic
    // structural method implementation) after the shapes are planned. Storage keys identify type parameters only by
    // position, so such a carrier is an exact instance of the definition stored under its storage key.
    const implementation = rustStructuralObjectCarrierValue(carrier)?.implementation;
    const candidates = implementation?.kind !== "physical" ? [] : [...new Set(byStorageKey.values())].flatMap(origin => {
      const definition = methodStorageFinalized ? origin : physicalTemplateFor(origin);
      const selected = rustStructuralObjectCarrierValue(definition?.carrier)?.implementation;
      return definition !== undefined && selected?.kind === "physical" && selected.methods.length === implementation.methods.length &&
        selected.methods.every((method, index) => method.sourceName === implementation.methods[index]?.sourceName &&
          method.identity === implementation.methods[index]?.identity) ? [{ definition, origin }] : [];
    });
    const exact = byStorageKey.get(structuralStorageKey(carrier, componentForFile));
    if (exact !== undefined && implementation?.kind !== "physical") candidates.unshift({
      definition: methodStorageFinalized ? exact : physicalTemplateFor(exact) ?? exact, origin: exact,
    });
    const matches = candidates.flatMap(({ definition: template, origin }) => {
      const instance = instantiateStructuralDefinition(template, carrier);
      return instance === undefined ? [] : [{ template, instance, origin }];
    });
    if (matches.length > 1) return undefined;
    if (matches[0] === undefined) return undefined;
    const instance = registerCarrier(matches[0].instance, carrier, matches[0].origin);
    publishedInstances = Object.freeze([...byKey.values()].map(value => value.definition));
    return instance;
  };
  const plan: RustStructuralShapeLayoutPlan = Object.freeze({
    get unionDefinitions() { return unions.unionDefinitions; },
    unionForCarrier: (carrier: TargetTypeRef) => unions.unionForCarrier(carrier),
    get definitions() { return definitions; },
    get instances() { return publishedInstances; },
    sharesStorage(left: TargetTypeRef, right: TargetTypeRef) {
      const leftDefinition = definitionFor(left);
      const rightDefinition = definitionFor(right);
      return leftDefinition !== undefined && rightDefinition !== undefined &&
        leftDefinition.componentId === rightDefinition.componentId &&
        leftDefinition.targetName === rightDefinition.targetName &&
        leftDefinition.genericArguments.length === rightDefinition.genericArguments.length &&
        leftDefinition.genericArguments.every((argument, index) =>
          rustTargetGenericArgumentEquals(argument, rightDefinition.genericArguments[index]!));
    },
    definitionForCarrier: definitionFor,
    templateForCarrier: (carrier: TargetTypeRef) => completedPlan === undefined
      ? originsByKey.get(closedMetadataKey(carrier)) : completedPlan.templateForCarrier(carrier),
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      const field = Number.isSafeInteger(storageIndex) && storageIndex >= 0
        ? rustStructuralObjectCarrierValue(carrier)?.fields[storageIndex] : undefined;
      return field === undefined ? undefined : definitionFor(carrier)?.fields.find(candidate => candidate.sourceName === field.sourceName)?.targetName;
    },
    field(carrier: TargetTypeRef, storageIndex: number) {
      if (!Number.isSafeInteger(storageIndex) || storageIndex < 0) {
        return undefined;
      }
      const field = rustStructuralObjectCarrierValue(carrier)?.fields[storageIndex];
      return field === undefined ? undefined : definitionFor(carrier)?.fields.find(candidate => candidate.sourceName === field.sourceName);
    },
  });
  const requireCompleted = (): RustStructuralShapePlan => {
    if (completedPlan === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural storage requires its completed native method selection.");
    return completedPlan;
  };
  return Object.freeze({ plan,
    completed: requireCompleted,
    methodStorageFinalized: () => methodStorageFinalized,
    close() {
      if (closed) failTargetAnalysisInvariant("tsonic-rust", "Rust structural storage seals once.");
      const complete = requireCompleted();
      closed = true;
      byKey.clear();
      return complete;
    },
    instantiateSourceCarrier(source: TargetTypeRef, instance: TargetTypeRef) {
      const unresolved = (reason: string): RustStructuralPhysicalCarrierSelection => Object.freeze({ kind: "unresolved", reason });
      if (closed || methodStorageFinalized) return unresolved("Native source instances require their open original structural template.");
      const selected = definitionFor(source);
      const original = originsByKey.get(closedMetadataKey(source));
      if (selected === undefined || original === undefined || instantiateStructuralDefinition(original, instance) === undefined)
        return unresolved("A native source instance requires its exact original template and generic argument correspondence.");
      const owner = originsByKey.get(closedMetadataKey(instance));
      if (owner !== undefined && owner !== original)
        return unresolved("A native source instance cannot replace a different canonical structural owner.");
      registerCarrier(original, instance, original);
      publishedInstances = Object.freeze([...byKey.values()].map(value => value.definition));
      return Object.freeze({ kind: "resolved", carrier: instance });
    },
    completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef, evidence: RustStructuralPhysicalCompletionEvidence) {
      const unresolved = (reason: string): RustStructuralPhysicalCarrierSelection => Object.freeze({ kind: "unresolved", reason });
      if (evidence?.kind !== "instance" && evidence?.kind !== "native-input")
        return unresolved("Structural physical completion requires its exact instance or native-input evidence.");
      const sourceKey = closedMetadataKey(source);
      const registration = byKey.get(sourceKey);
      if (evidence.kind === "instance" && registration?.completion.kind === "physical" &&
        !rustTargetTypeRefEquals(normalizeCompletionCarrier(registration.completion.carrier), normalizeCompletionCarrier(physical)))
        return unresolved("A structural source instance requires one exact native implementation and capture environment.");
      if (evidence.kind === "native-input") {
        const shape = rustStructuralObjectCarrierValue(physical);
        const extendsSubject = (subject: SourceStorageSubject, prefix: SourceStorageSubject): boolean =>
          subject.kind === "input" && subject.node === prefix.node && subject.projection.length >= prefix.projection.length &&
          (prefix.projectionKey.length === 0 || subject.projectionKey === prefix.projectionKey ||
            subject.projectionKey.startsWith(`${prefix.projectionKey}/`));
        if (evidence.subject.kind !== "input" || shape === undefined || !evidence.fields?.length || evidence.fields.some(field => {
          const selected = shape.fields.find(selected => selected.sourceName === field.sourceName);
          const component = field.subject.projection[field.subject.projection.length - 1];
          if (selected === undefined || !rustTargetTypeRefEquals(selected.type, field.carrier) ||
            field.subject.projection.length !== evidence.subject.projection.length + 1 ||
            component?.kind !== "member" || field.member?.property.name !== field.sourceName ||
            !field.member.declarations.includes(component.declaration) || !extendsSubject(field.subject, evidence.subject) ||
            field.inputs.length === 0) return true;
          const identities = new Set(rustTargetGenericReferences(field.carrier).typeIdentities);
          return field.inputs.some(input => input.owner !== evidence.owner || !extendsSubject(input.subject, field.subject) ||
            !identities.has(input.implementation.identity));
        })) return unresolved("Native structural input completion requires its original projected implementation bindings.");
      }
      if (methodStorageFinalized) {
        if (completeFinalPhysical === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "Completed structural storage requires its canonical physical registration owner.");
        return completeFinalPhysical(source, physical, evidence);
      }
      const selected = definitionFor(source);
      const original = originsByKey.get(sourceKey) ?? (selected === undefined ? undefined
        : definitions.find(definition => definition.targetName === selected.targetName && definition.componentId === selected.componentId));
      const value = rustStructuralObjectCarrierValue(physical);
      if (original === undefined || value === undefined || value.implementation !== undefined && value.implementation.kind !== "physical")
        return unresolved("Structural physical completion requires its actual source owner and completed native capture arguments.");
      const values = completedCarriers.get(original) ?? new Map();
      completedCarriers.set(original, values);
      const completionKey = closedMetadataKey({ source, carrier: physical });
      const previous = values.get(completionKey);
      const sameLayoutInstance = instantiateStructuralDefinition(original, physical) !== undefined;
      const carrier = sameLayoutInstance ? original.carrier : rustStructuralGenericCarrier(physical, "fields").carrier;
      const references = rustTargetGenericReferences(carrier);
      const physicalOwner = originsByKey.get(closedMetadataKey(physical));
      const completedOwner = physicalOwner === undefined || physicalOwner === original ? undefined : physicalTemplateFor(physicalOwner);
      if (physicalOwner !== undefined && physicalOwner !== original && completedOwner === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural implementation requires its actual completed native template.");
      const template = physicalOwner !== undefined && physicalOwner !== original ? completedOwner!
        : sameLayoutInstance ? original : Object.freeze({ ...original, carrier,
        genericParameters: Object.freeze([
          ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime: lifetime as Extract<RustLifetimeRef, { kind: "parameter" }> })),
          ...references.typeParameters.map(parameter => ({ kind: "type" as const, identity: parameter.identity, name: parameter.name })),
        ]),
        genericArguments: Object.freeze([
          ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...references.typeParameters.map(type => ({ kind: "type" as const, type })),
        ]),
      });
      const inputs = Object.freeze([...new Set([...(previous?.inputs ?? []),
        ...(evidence.kind === "native-input" ? evidence.fields.flatMap(field => field.inputs) : [])])]);
      values.set(completionKey, Object.freeze({ source, carrier: physical, template, inputs }));
      if (physicalOwner === undefined || physicalOwner === original) registerCarrier(template, physical, original);
      for (const key of evidence.kind === "instance" ? [sourceKey, closedMetadataKey(physical)] : [closedMetadataKey(physical)]) {
        const registered = byKey.get(key);
        if (registered !== undefined) byKey.set(key, Object.freeze({ ...registered,
          completion: Object.freeze({ kind: "physical", carrier: physical }) }));
      }
      publishedInstances = Object.freeze([...byKey.values()].map(value => value.definition));
      return Object.freeze({ kind: "resolved", carrier: physical });
    },
    finalizeMethodStorage(selections, errorForFile) {
      if (methodStorageFinalized) throw new Error("Structural method physical storage finalizes exactly once.");
      if (typeof errorForFile !== "function") failTargetAnalysisInvariant("tsonic-rust",
        "Structural physical finalization requires its complete declared-component error selection.");
      const selectPhysicalCarrier = (carrier: TargetTypeRef): TargetTypeRef =>
        selectRustStructuralPhysicalDestinations(carrier, errorForFile);
      normalizeCompletionCarrier = selectPhysicalCarrier;
      const replacements = new Map<RustStructuralShapeLayout, RustStructuralShapeDefinition>();
      for (const definition of definitions) {
        const fields = selections.get(definition);
        const template = physicalTemplateFor(definition);
        if (template !== undefined && (template.targetName !== definition.targetName ||
          template.componentId !== definition.componentId)) continue;
        if (definition.fields.some(field => field.methodPlan?.kind === "fixed") && template === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method requires its completed physical template before publication.");
        const carrier = selectPhysicalCarrier(template === undefined ? definition.carrier : template.carrier);
        const physicalShape = rustStructuralObjectCarrierValue(carrier);
        if (physicalShape === undefined) failTargetAnalysisInvariant("tsonic-rust",
          "An admitted structural definition requires its completed native field layout.");
        const construction = definition.construction === undefined ? undefined : physicalShape.construction === undefined
          ? failTargetAnalysisInvariant("tsonic-rust", "A completed structural shape requires its exact native construction slot.")
          : Object.freeze({ ...definition.construction, carrier: physicalShape.construction });
        for (const [index] of fields ?? []) {
          if (definition.fields[index]?.method !== true)
            throw new Error("Structural method storage can replace only an admitted method slot.");
        }
        const selectedFields = Object.freeze(definition.fields.map((field, index): RustStructuralShapeField => {
            const nativeField = physicalShape.fields[index];
            if (nativeField === undefined || nativeField.sourceName !== field.sourceName ||
              (nativeField.method === true) !== (field.method === true))
              failTargetAnalysisInvariant("tsonic-rust", "A completed structural field requires its exact original native member correspondence.");
            if (field.method !== true) {
              if (field.methodPlan !== undefined) failTargetAnalysisInvariant("tsonic-rust",
                "A completed structural data field cannot carry a method storage plan.");
              let boundStorage = field.boundStorage;
              if (boundStorage !== undefined) {
                const bound = rustNamedTypeCarrierValue(boundStorage.carrier);
                const error = bound?.id === "rust.runtime.RecordField" ? bound.genericArguments[1] : undefined;
                if (error?.kind !== "type") failTargetAnalysisInvariant("tsonic-rust",
                  "A completed bound structural field requires its original native error carrier.");
                const selectedError = rustProgramErrorOwner(error.type)?.kind === "logical"
                  ? errorForFile(physicalShape.ownerFileName) : error.type;
                if (selectedError === undefined) failTargetAnalysisInvariant("tsonic-rust",
                  "A bound structural field requires its own component's native access-error carrier.");
                boundStorage = Object.freeze({ ...boundStorage,
                  carrier: rustRuntimeRecordFieldTargetType(nativeField.type, selectedError) });
              }
              return Object.freeze({ ...field, carrier: nativeField.type, methodPlan: undefined,
                ...(boundStorage === undefined ? {} : { boundStorage }),
              });
            }
            const selected = fields?.get(index);
            if (selected === undefined) {
              const methodPlan = field.methodPlan;
              if (methodPlan?.kind === "fixed") failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method requires its complete selected native body before publication.", methodPlan.declaration);
              return Object.freeze({ ...field, carrier: rustTargetTypeRefEquals(field.carrier, nativeField.type) ? field.carrier : nativeField.type,
                methodPlan: methodPlan === undefined ? undefined : Object.freeze({ ...methodPlan, carrier: selectPhysicalCarrier(methodPlan.carrier) }) });
            }
            const selection = Object.freeze({ ...selected, carrier: selectPhysicalCarrier(selected.carrier),
              constructions: Object.freeze(selected.constructions.map(construction => Object.freeze({ ...construction,
                physicalCarrier: selectPhysicalCarrier(construction.physicalCarrier), destinationCarrier: selectPhysicalCarrier(construction.destinationCarrier),
              }))) });
            const destinationCarrier = field.presence === "optional" ? rustOptionElementCarrier(selection.carrier) : selection.carrier;
            const destination = rustCallableProtocol(destinationCarrier);
            if (selection.constructions.some(construction => construction.storageIndex !== index ||
              !rustTargetTypeRefEquals(construction.destinationCarrier, destinationCarrier)))
              throw new Error("Structural method construction requires its exact destination field.");
            for (const construction of selection.constructions) {
              const physical = rustCallablePhysicalSignature(construction.physicalCarrier);
              if (physical === undefined || destination === undefined || physical.parameters.length !== destination.parameters.length ||
                !physical.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, destination.parameters[index])) ||
                !rustTargetTypeRefEquals(physical.result, destination.result) || !rustTargetTypeRefEquals(physical.error, destination.error))
                throw new Error("Structural method construction requires its complete native source and destination signature.");
            }
            const methodPlan = field.methodPlan;
            if (methodPlan === undefined) failTargetAnalysisInvariant("tsonic-rust", "A completed structural method requires its selected native exposure.");
            const constructions = Object.freeze(selection.constructions.map(construction => Object.freeze({ ...construction })));
            if (methodPlan.kind !== "fixed") {
              if (selection.nativeBody !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Only a selected fixed method publishes a native body payload.");
              if (destination === undefined) failTargetAnalysisInvariant("tsonic-rust", "A stored structural method requires its exact selected physical invocation protocol.");
              const valueCarrier = rustCallableTargetType(methodPlan.receiver === "included" ? destination.parameters.slice(1)
                : destination.parameters, destination.result, destination.lifetime, destination.error);
              return Object.freeze({ ...field, carrier: field.presence === "optional" ? rustOptionTargetType(valueCarrier) : valueCarrier,
                methodPlan: Object.freeze({ ...methodPlan, carrier: selection.carrier, constructions }) });
            }
            const physical = rustStructuralObjectCarrierValue(carrier)?.implementation?.methods.find(method => method.sourceName === field.sourceName);
            const body = selection.nativeBody;
            if (physical === undefined || body === undefined || body.declaration !== methodPlan.declaration)
              failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method requires its exact native construction and physical capture environment.", methodPlan.declaration);
            let captureIndex = 0;
            const payload = Object.freeze({
              captures: Object.freeze(body.payload.captures.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method lost its physical capture argument.", methodPlan.declaration);
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
              receiverFields: Object.freeze(body.payload.receiverFields.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method lost its physical receiver-field argument.", methodPlan.declaration);
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
              receivers: Object.freeze(body.payload.receivers.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method lost its physical receiver argument.", methodPlan.declaration);
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
            });
            if (captureIndex !== physical.genericArguments.length || body.receiverFieldIdentities.length !== payload.receiverFields.length)
              failTargetAnalysisInvariant("tsonic-rust", "A fixed structural method requires its complete physical capture argument inventory.", methodPlan.declaration);
            return Object.freeze({ ...field, carrier: rustTargetTypeRefEquals(field.carrier, nativeField.type) ? field.carrier : nativeField.type,
              methodPlan: Object.freeze({ ...methodPlan, carrier: selection.carrier,
              payload, context: selectRustStructuralMethodContextCarrier(payload, body.receiverFieldIdentities),
              factoryReceiver: body.factoryReceiver, constructions }),
            });
          }));
        const references = rustTargetGenericReferences(carrier);
        const storedReferences = rustTargetGenericReferences({ kind: "tuple", elements: [
          ...selectedFields.flatMap(field => field.methodPlan?.kind === "fixed" ? [] : [field.methodPlan?.carrier ?? field.carrier]),
          ...(construction === undefined ? [] : [construction.carrier]),
        ] });
        const stateReferences = definition.dispatchName === undefined ? rustTargetGenericReferences({ kind: "tuple", elements: [
          ...selectedFields.flatMap(field => field.methodPlan?.kind === "fixed"
            ? [field.methodPlan.context] : [field.methodPlan?.carrier ?? field.carrier]),
          ...(construction === undefined ? [] : [construction.carrier]),
        ] }) : references;
        const markerArguments = Object.freeze([
          ...stateReferences.lifetimes.filter(lifetime => !storedReferences.lifetimeIdentities.includes(
            rustLifetimeKey(lifetime))).map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...stateReferences.typeParameters.filter(parameter => !storedReferences.typeIdentities.includes(parameter.identity))
            .map(type => ({ kind: "type" as const, type })),
        ]);
        const usedFieldNames = new Set(selectedFields.flatMap(field => [field.targetName,
          ...(field.property === undefined ? [] : [field.property.getterTargetName,
            ...(field.property.setterTargetName === undefined ? [] : [field.property.setterTargetName])])]));
        const contextMarker = markerArguments.length === 0 ? undefined : Object.freeze({
          name: allocateSnakeName(usedFieldNames, "_context_marker"), arguments: markerArguments,
        });
        const contextConstructor = definition.dispatchName !== undefined || !selectedFields.some(field => field.methodPlan?.kind === "fixed")
          ? undefined : Object.freeze({ name: allocateSnakeName(usedFieldNames, "with_context"),
            contextParameter: allocateSnakeName(usedFieldNames, "_native_context"),
            identityName: allocateSnakeName(usedFieldNames, "with_context_and_identity"),
            identityParameter: allocateSnakeName(usedFieldNames, "_native_identity") });
        replacements.set(definition, Object.freeze({ ...definition, carrier, fields: selectedFields,
          ...(construction === undefined ? {} : { construction }),
          genericParameters: Object.freeze([
            ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime: lifetime as Extract<RustLifetimeRef, { kind: "parameter" }> })),
            ...references.typeParameters.map(parameter => ({ kind: "type" as const, identity: parameter.identity, name: parameter.name })),
          ]),
          genericArguments: Object.freeze([
            ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
            ...references.typeParameters.map(type => ({ kind: "type" as const, type })),
          ]),
          stateGenericParameters: Object.freeze([
            ...stateReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime: lifetime as Extract<RustLifetimeRef, { kind: "parameter" }> })),
            ...stateReferences.typeParameters.map(parameter => ({ kind: "type" as const, identity: parameter.identity, name: parameter.name })),
          ]),
          stateGenericArguments: Object.freeze([
            ...stateReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
            ...stateReferences.typeParameters.map(type => ({ kind: "type" as const, type })),
          ]),
          contextMarker, contextConstructor,
        }));
      }
      for (const definition of definitions) {
        if (replacements.has(definition)) continue;
        const completed = [...(completedCarriers.get(definition)?.values() ?? [])]
          .find(value => rustTargetTypeRefEquals(value.source, definition.carrier));
        const owner = completed === undefined ? undefined : definitions.find(candidate =>
          candidate.targetName === completed.template.targetName && candidate.componentId === completed.template.componentId);
        const replacement = owner === undefined ? undefined : replacements.get(owner);
        const instance = completed === undefined || replacement === undefined ? undefined
          : instantiateStructuralDefinition(replacement, selectPhysicalCarrier(completed.carrier));
        if (instance === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural contract requires its completed actual native implementation owner.");
        replacements.set(definition, instance);
      }
      for (const definition of selections.keys()) {
        if (!replacements.has(definition)) throw new Error("Structural method storage requires its exact canonical definition.");
      }
      const finalDefinitions = Object.freeze(definitions.filter(definition => {
        const template = physicalTemplateFor(definition);
        return template === undefined || template.targetName === definition.targetName && template.componentId === definition.componentId;
      }).map(definition => replacements.get(definition)!));
      const sourceDefinitions = new Map(byStorageKey);
      const canonical = new Map(finalDefinitions.map(definition => [`${definition.componentId}\0${definition.targetName}`, definition]));
      const canonicalFor = (definition: RustStructuralShapeDefinition): RustStructuralShapeDefinition => {
        const selected = canonical.get(`${definition.componentId}\0${definition.targetName}`);
        if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A structural physical instance requires its one canonical native implementation owner.");
        return selected;
      };
      const instances = new Map<string, RustStructuralShapeDefinition>();
      const physicalInstances = new Map<string, RustStructuralShapeDefinition>();
      const instanceOwners = new Map([...originsByKey].map(([key, definition]) => [key, canonicalFor(replacements.get(definition)!)]));
      const instantiatePhysical = (definition: RustStructuralShapeDefinition, carrier: TargetTypeRef): RustStructuralShapeDefinition | undefined => {
        const owner = canonicalFor(definition);
        const key = closedMetadataKey(carrier);
        const selected = instantiateStructuralDefinition(owner, carrier);
        if (selected === undefined) return undefined;
        const identity = closedMetadataKey({ componentId: owner.componentId, targetName: owner.targetName,
          genericArguments: selected.genericArguments, stateGenericArguments: selected.stateGenericArguments });
        const previous = physicalInstances.get(identity);
        if (previous !== undefined) {
          if (previous.componentId !== owner.componentId || previous.targetName !== owner.targetName)
            failTargetAnalysisInvariant("tsonic-rust", "An exact physical structural carrier requires its one canonical native implementation owner.");
          instances.set(key, previous);
          instanceOwners.set(key, owner);
          return previous;
        }
        physicalInstances.set(identity, selected);
        instances.set(key, selected);
        instanceOwners.set(key, owner);
        return selected;
      };
      const nativeInputDefinitions = new Set([...completedCarriers].flatMap(([definition, completed]) =>
        [...completed.values()].some(value => value.inputs.length !== 0)
          ? [definition] : []));
      for (const [key, registration] of byKey) {
        const selected = registration.definition;
        const origin = originsByKey.get(key);
        const replacement = origin === undefined ? undefined : replacements.get(origin);
        const sourceReferences = origin === undefined ? undefined : rustTargetGenericReferences(origin.carrier);
        const sourceBindings = origin === undefined || sourceReferences === undefined ? undefined
          : inferRustTargetGenericBindings(origin.carrier, selected.carrier, {
            typeIdentities: new Set(sourceReferences.typeIdentities), lifetimeIdentities: new Set(sourceReferences.lifetimeIdentities),
            constIdentities: new Set(sourceReferences.constIdentities),
          });
        const instanceCarrier = registration.completion.kind === "physical" ? selectPhysicalCarrier(registration.completion.carrier)
          : origin !== undefined && nativeInputDefinitions.has(origin) ? selectPhysicalCarrier(selected.carrier)
            : replacement === undefined || sourceBindings === undefined ? undefined
              : substituteRustTargetGenerics(replacement.carrier, sourceBindings.types, sourceBindings.lifetimes, sourceBindings.consts);
        const instance = replacement === undefined || instanceCarrier === undefined ? undefined : instantiatePhysical(replacement, instanceCarrier);
        if (instance === undefined) throw new Error("Structural physical storage lost its exact template-to-instance correspondence.");
        instances.set(key, instance);
      }
      const storageOwners = new Map([...byStorageKey].map(([key, definition]) => [key, canonicalFor(replacements.get(definition)!)]));
      for (const instance of physicalInstances.values()) {
        const owner = canonicalFor(instance);
        storageOwners.set(structuralStorageKey(instance.carrier, componentForFile), owner);
      }
      let finalInstances = Object.freeze([...physicalInstances.values()]);
      definitions = finalDefinitions;
      const registerFinal = (definition: RustStructuralShapeDefinition, carrier: TargetTypeRef): RustStructuralShapeDefinition | undefined => {
        const selected = instantiatePhysical(definition, carrier);
        if (selected === undefined) return undefined;
        const key = closedMetadataKey(carrier);
        instances.set(key, selected);
        instanceOwners.set(key, definition);
        storageOwners.set(structuralStorageKey(carrier, componentForFile), definition);
        finalInstances = Object.freeze([...physicalInstances.values()]);
        publishedInstances = finalInstances;
        return selected;
      };
      completeFinalPhysical = (source, physical, evidence) => {
        const owner = instanceOwners.get(closedMetadataKey(source));
        const selected = owner === undefined ? undefined : registerFinal(owner, physical);
        if (selected === undefined) return Object.freeze({ kind: "unresolved",
          reason: "A structural physical carrier requires its exact source owner and native generic correspondence." });
        if (evidence.kind === "instance") {
          const key = closedMetadataKey(source);
          instances.set(key, selected);
          instanceOwners.set(key, canonicalFor(selected));
          byKey.set(key, Object.freeze({ definition: selected,
            completion: Object.freeze({ kind: "physical", carrier: physical }) }));
        }
        return Object.freeze({ kind: "resolved", carrier: selected.carrier });
      };
      for (const [original, completed] of completedCarriers) for (const selected of completed.values()) {
        const replacement = canonicalFor(replacements.get(original)!);
        if (registerFinal(replacement, selectPhysicalCarrier(selected.carrier)) === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "A completed structural method requires its admitted native template arguments.");
      }
      finalInstances = Object.freeze([...physicalInstances.values()]);
      publishedInstances = finalInstances;
      const finalDefinitionFor = (carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined => {
        if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) return undefined;
        const selected = instances.get(closedMetadataKey(carrier));
        if (selected !== undefined || closed) return selected;
        const implementation = rustStructuralObjectCarrierValue(carrier)?.implementation;
        const storageKey = structuralStorageKey(carrier, componentForFile);
        const sourceDefinition = implementation?.kind === "physical" ? undefined : sourceDefinitions.get(storageKey);
        if (sourceDefinition !== undefined) {
          const source = instantiateStructuralDefinition(sourceDefinition, carrier);
          const replacement = replacements.get(sourceDefinition);
          if (source === undefined || replacement === undefined) return undefined;
          const types = new Map<string, TargetTypeRef>();
          const lifetimes = new Map<string, RustLifetimeRef>();
          for (const [index, parameter] of sourceDefinition.genericParameters.entries()) {
            const argument = source.genericArguments[index];
            if (parameter.kind === "type" && argument?.kind === "type") types.set(parameter.identity, argument.type);
            else if (parameter.kind === "lifetime" && argument?.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
            else return undefined;
          }
          const selected = registerFinal(canonicalFor(replacement), nativeInputDefinitions.has(sourceDefinition)
            ? selectPhysicalCarrier(source.carrier) : substituteRustTargetGenerics(replacement.carrier, types, lifetimes));
          if (selected !== undefined) {
            const key = closedMetadataKey(carrier);
            instances.set(key, selected);
            instanceOwners.set(key, canonicalFor(replacement));
          }
          return selected;
        }
        const templates = implementation?.kind !== "physical" ? [storageOwners.get(structuralStorageKey(carrier, componentForFile))]
          : finalDefinitions.filter(definition => {
            const physical = rustStructuralObjectCarrierValue(definition.carrier)?.implementation;
            return physical?.kind === "physical" && physical.methods.length === implementation.methods.length &&
              physical.methods.every((method, index) => method.sourceName === implementation.methods[index]?.sourceName &&
                method.identity === implementation.methods[index]?.identity);
          });
        const matches = templates.flatMap(definition => definition === undefined ? [] :
          instantiateStructuralDefinition(definition, carrier) === undefined ? [] : [definition]);
        return matches.length === 1 ? registerFinal(matches[0]!, carrier) : undefined;
      };
      const finalField = (carrier: TargetTypeRef, storageIndex: number): RustStructuralShapeField | undefined => {
        if (!Number.isSafeInteger(storageIndex) || storageIndex < 0) return undefined;
        const field = rustStructuralObjectCarrierValue(carrier)?.fields[storageIndex];
        return field === undefined ? undefined : finalDefinitionFor(carrier)?.fields.find(candidate => candidate.sourceName === field.sourceName);
      };
      completedPlan = Object.freeze({
        get definitions() { return finalDefinitions; },
        get instances() { return finalInstances; },
        get unionDefinitions() { return unions.unionDefinitions; },
        unionForCarrier: (carrier: TargetTypeRef) => unions.unionForCarrier(carrier),
        definitionForCarrier: finalDefinitionFor,
        templateForCarrier: (carrier: TargetTypeRef) => instanceOwners.get(closedMetadataKey(carrier)),
        field: finalField,
        fieldName: (carrier: TargetTypeRef, storageIndex: number) => finalField(carrier, storageIndex)?.targetName,
        sharesStorage: plan.sharesStorage,
      });
      byStorageKey.clear();
      originsByKey.clear();
      completedCarriers.clear();
      methodStorageFinalized = true;
    },
  });
}
