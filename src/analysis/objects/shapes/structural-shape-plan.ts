import { structuralStorageKey, instantiateStructuralDefinition, bindRustStructuralImplementationContract } from "../../../policy/types/objects/structural-storage.js";
import { preferredShapeName, allocateSnakeName, allocatePascalName } from "../../names/structural-storage.js";
import type { RustStructuralShapeField, RustStructuralShapeDefinition, RustStructuralMethodStorageSelection, RustStructuralMethodExposure, RustStructuralMethodPlan } from "../../../target-model/records/structural-shapes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustPropertyStorageNames } from "../../../target-model/names/property-storage.js";
import type { RustStructuralInstantiation } from "../../../target-model/records/source-types.js";
import type { RustSourceUnionDefinition } from "../../../target-model/types/source-union-definitions.js";
import { createRustGeneratedUnionPlan, type RustGeneratedUnionPlan } from "./generated-union-plan.js";
import type { RustNativeObjectField } from "../../../target-model/operations/native-memory.js";
import { rustNativeMemoryLayoutsEqual } from "../../../target-model/operations/native-memory.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { rustStructuralObjectCarrierValue, rustTargetGenericReferences, rustOptionElementCarrier, rustCallableProtocol, rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustStructuralMethodStorageCarrier } from "../../../policy/types/objects/member-storage.js";
import { rustRuntimeRecordFieldTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";

import { rustStructuralGenericCarrier } from "../../../policy/types/objects/structural-generics.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { RustSourceObjectShape, RustStructuralFieldImplementation } from "../../../target-model/records/source-types.js";


export interface RustStructuralShapePlan extends RustGeneratedUnionPlan {
  readonly definitions: readonly RustStructuralShapeDefinition[];
  readonly instances: readonly RustStructuralShapeDefinition[];
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined;
  templateForCarrier(carrier: TargetTypeRef): RustStructuralShapeDefinition | undefined;
  sharesStorage(left: TargetTypeRef, right: TargetTypeRef): boolean;
  fieldName(carrier: TargetTypeRef, storageIndex: number): string | undefined;
  field(carrier: TargetTypeRef, storageIndex: number): RustStructuralShapeField | undefined;
}

export interface RustStructuralShapePlanRegistry extends RustStructuralShapePlan {
  initialize(
    shapes: readonly RustSourceObjectShape[],
    implementations: readonly RustStructuralFieldImplementation[],
    componentForFile: (fileName: string) => string,
    nativeFields: readonly RustNativeObjectField[],
    instantiations: readonly RustStructuralInstantiation[],
    methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
    receiverIndependentMethods?: ReadonlySet<string>,
  ): RustStructuralShapePlan;
  initializeUnions(unions: readonly RustSourceUnionDefinition[]): void;
  completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef): TargetTypeRef;
  finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeDefinition,
    ReadonlyMap<number, RustStructuralMethodStorageSelection>>): void;
  isInitialized(): boolean;
  seal(): RustStructuralShapePlan;
}

export function createRustStructuralShapePlanRegistry(): RustStructuralShapePlanRegistry {
  let current: RustStructuralShapePlan | undefined;
  let sealed = false;
  let construction: ReturnType<typeof createRustStructuralShapeConstruction> | undefined;
  let unions: RustGeneratedUnionPlan | undefined;
  let componentForFile: ((fileName: string) => string) | undefined;
  const requireCurrent = (): RustStructuralShapePlan => {
    if (current === undefined) {
      throw new Error("Rust structural shape plan was read before source analysis initialized it.");
    }
    return current;
  };
  const requireUnions = (): RustGeneratedUnionPlan => {
    if (unions === undefined) throw new Error("Rust generated unions must be finalized after physical value selection.");
    return unions;
  };
  return Object.freeze({
    initialize(
      shapes: readonly RustSourceObjectShape[],
      implementations: readonly RustStructuralFieldImplementation[],
      selectComponent: (fileName: string) => string,
      nativeFields: readonly RustNativeObjectField[],
      instantiations: readonly RustStructuralInstantiation[],
      methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
      receiverIndependentMethods: ReadonlySet<string> = new Set(),
    ) {
      if (sealed || current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      componentForFile = selectComponent;
      construction = createRustStructuralShapeConstruction(shapes, implementations, selectComponent, nativeFields, instantiations, {
        get unionDefinitions() { return requireUnions().unionDefinitions; },
        unionForCarrier: (carrier: TargetTypeRef) => requireUnions().unionForCarrier(carrier),
      }, methodExposures, receiverIndependentMethods);
      current = construction.plan;
      return current;
    },
    initializeUnions(definitions: readonly RustSourceUnionDefinition[]) {
      // A second finalization is refused as such, also after sealing (sealing requires the first one).
      if (unions !== undefined) throw new Error("Rust generated unions can be finalized only once after structural objects.");
      if (sealed) throw new Error("Rust structural unions cannot change after sealing.");
      const shapes = requireCurrent();
      if (componentForFile === undefined)
        throw new Error("Rust generated unions can be finalized only once after structural objects.");
      const names = new Map<string, Set<string>>();
      for (const shape of shapes.definitions) {
        const selected = names.get(shape.componentId) ?? new Set<string>();
        selected.add(shape.targetName);
        if (shape.dispatchName !== undefined) selected.add(shape.dispatchName);
        names.set(shape.componentId, selected);
      }
      unions = createRustGeneratedUnionPlan(definitions, componentForFile, names);
    },
    completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef) {
      if (sealed || construction === undefined) throw new Error("Structural physical carriers require their open initialized builder.");
      return construction.completePhysicalCarrier(source, physical);
    },
    finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeDefinition,
      ReadonlyMap<number, RustStructuralMethodStorageSelection>>) {
      // A second finalization is refused as such, also after sealing.
      if (construction?.methodStorageFinalized() === true || !sealed && construction !== undefined) {
        construction.finalizeMethodStorage(selections);
        return;
      }
      throw new Error("Structural method storage requires its open initialized shape builder.");
    },
    isInitialized() {
      return current !== undefined;
    },
    seal() {
      if (sealed) throw new Error("Rust structural storage seals once.");
      requireUnions();
      construction!.close();
      sealed = true;
      return requireCurrent();
    },
    get definitions() {
      return requireCurrent().definitions;
    },
    get instances() {
      return requireCurrent().instances;
    },
    get unionDefinitions() {
      return requireCurrent().unionDefinitions;
    },
    unionForCarrier(carrier: TargetTypeRef) {
      return requireCurrent().unionForCarrier(carrier);
    },
    definitionForCarrier(carrier: TargetTypeRef | undefined) {
      return requireCurrent().definitionForCarrier(carrier);
    },
    templateForCarrier(carrier: TargetTypeRef) {
      return requireCurrent().templateForCarrier(carrier);
    },
    sharesStorage(left: TargetTypeRef, right: TargetTypeRef) {
      return requireCurrent().sharesStorage(left, right);
    },
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      return requireCurrent().fieldName(carrier, storageIndex);
    },
    field(carrier: TargetTypeRef, storageIndex: number) {
      return requireCurrent().field(carrier, storageIndex);
    },
  });
}

export function createRustStructuralShapePlan(
  shapes: readonly RustSourceObjectShape[],
  implementations: readonly RustStructuralFieldImplementation[],
  componentForFile: (fileName: string) => string,
  nativeFields: readonly RustNativeObjectField[],
  methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
  instantiations: readonly RustStructuralInstantiation[] = [],
  unions: RustGeneratedUnionPlan = createRustGeneratedUnionPlan([], componentForFile, new Map()),
  receiverIndependentMethods: ReadonlySet<string> = new Set(),
): RustStructuralShapePlan {
  return createRustStructuralShapeConstruction(shapes, implementations, componentForFile, nativeFields,
    instantiations, unions, methodExposures, receiverIndependentMethods).plan;
}

function createRustStructuralShapeConstruction(
  shapes: readonly RustSourceObjectShape[],
  implementations: readonly RustStructuralFieldImplementation[],
  componentForFile: (fileName: string) => string,
  nativeFields: readonly RustNativeObjectField[],
  instantiations: readonly RustStructuralInstantiation[],
  unions: RustGeneratedUnionPlan,
  methodExposures: ReadonlyMap<string, RustStructuralMethodExposure>,
  receiverIndependentMethods: ReadonlySet<string>,
): {
  readonly plan: RustStructuralShapePlan;
  methodStorageFinalized(): boolean;
  close(): void;
  completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef): TargetTypeRef;
  finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeDefinition,
    ReadonlyMap<number, RustStructuralMethodStorageSelection>>): void;
} {
  const selections = new Map<TargetTypeRef, ReturnType<typeof rustStructuralGenericCarrier>>();
  const physicalSelection = (carrier: TargetTypeRef): ReturnType<typeof rustStructuralGenericCarrier> => {
    const existing = selections.get(carrier);
    if (existing !== undefined) return existing;
    const selected = rustStructuralGenericCarrier(carrier);
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
  let definitions: readonly RustStructuralShapeDefinition[] = Object.freeze([...grouped]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, instances]): RustStructuralShapeDefinition => {
      const sourceCarriers = Object.freeze([...instances]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, carrier]) => carrier));
      const selection = physicalSelection([...uniqueByKey.get(key)!]
        .sort(([left], [right]) => left.localeCompare(right, "en"))[0]![1]);
      const carrier = selection.carrier;
      for (const source of sourceCarriers) nestedCarriers.push(...physicalSelection(source).nestedCarriers);
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural === undefined) {
        throw new Error("Rust structural shape plan contains a non-structural carrier.");
      }
      const componentId = componentForFile(structural.ownerFileName);
      const usedTypeNames = usedTypeNamesByComponent.get(componentId) ?? new Set<string>();
      usedTypeNamesByComponent.set(componentId, usedTypeNames);
      const fieldNames = rustPropertyStorageNames(structural.fields.map(field => field.sourceName));
      const usedFieldNames = new Set(fieldNames.values());
      const nativeDispatch = structural.construction !== undefined || implementations.some(implementation =>
        implementation.kind === "dispatch" && instances.has(closedMetadataKey(implementation.carrier)));
      const fields = structural.fields.map((field, storageIndex): RustStructuralShapeField => {
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
        const methodPlan: RustStructuralMethodPlan | undefined = methodStorageCarrier === undefined || exposure === undefined
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
  const byKey = new Map<string, RustStructuralShapeDefinition>();
  const byStorageKey = new Map<string, RustStructuralShapeDefinition>();
  const originsByKey = new Map<string, RustStructuralShapeDefinition>();
  const registerCarrier = (definition: RustStructuralShapeDefinition, carrier: TargetTypeRef, origin: RustStructuralShapeDefinition): void => {
    const key = closedMetadataKey(carrier);
    const existing = byKey.get(key);
    if (existing !== undefined && (existing.targetName !== definition.targetName ||
      existing.componentId !== definition.componentId)) {
      throw new Error("Rust structural storage has conflicting canonical template identities.");
    }
    const selected = instantiateStructuralDefinition(definition, carrier);
    if (selected === undefined) throw new Error("Rust structural storage requires an exact generic-parameter correspondence.");
    byKey.set(key, selected);
    const storageKey = structuralStorageKey(carrier, componentForFile);
    const storage = byStorageKey.get(storageKey);
    if (storage !== undefined && (storage.targetName !== definition.targetName || storage.componentId !== definition.componentId)) {
      throw new Error("Rust structural storage has conflicting canonical template identities.");
    }
    byStorageKey.set(storageKey, origin);
    originsByKey.set(key, origin);
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
  let publishedInstances = Object.freeze([...byKey.values()]);
  let closed = false;
  let methodStorageFinalized = false;
  const completedCarriers = new Map<RustStructuralShapeDefinition, Map<string,
    { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef; readonly template: RustStructuralShapeDefinition }>>();
  const physicalTemplateFor = (definition: RustStructuralShapeDefinition): RustStructuralShapeDefinition | undefined => {
    const completed = completedCarriers.get(definition);
    return completed?.get(closedMetadataKey(definition.carrier))?.template ?? definition.sourceCarriers
      .map(source => completed?.get(closedMetadataKey(source))?.template).find(selected => selected !== undefined);
  };
  const definitionFor = (carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined => {
    if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) return undefined;
    const key = closedMetadataKey(carrier);
    const registered = byKey.get(key);
    if (registered !== undefined) return registered;
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
    if (matches.length > 1) throw new Error("A structural physical instance has more than one checked native implementation template.");
    const instance = matches[0]?.instance;
    if (instance !== undefined) {
      registerCarrier(matches[0]!.template, carrier, matches[0]!.origin);
      publishedInstances = Object.freeze([...publishedInstances, instance]);
    }
    return instance;
  };
  const plan: RustStructuralShapePlan = Object.freeze({
    get unionDefinitions() { return unions.unionDefinitions; },
    unionForCarrier: (carrier: TargetTypeRef) => unions.unionForCarrier(carrier),
    get definitions() { return definitions; },
    get instances() { return publishedInstances; },
    sharesStorage(left: TargetTypeRef, right: TargetTypeRef) {
      const leftDefinition = definitionFor(left);
      const rightDefinition = definitionFor(right);
      return leftDefinition !== undefined && rightDefinition !== undefined &&
        rustTargetTypeRefEquals(leftDefinition.carrier, left) &&
        rustTargetTypeRefEquals(rightDefinition.carrier, right) &&
        leftDefinition.componentId === rightDefinition.componentId &&
        leftDefinition.targetName === rightDefinition.targetName &&
        leftDefinition.genericArguments.length === rightDefinition.genericArguments.length &&
        leftDefinition.genericArguments.every((argument, index) =>
          rustTargetGenericArgumentEquals(argument, rightDefinition.genericArguments[index]!));
    },
    definitionForCarrier: definitionFor,
    templateForCarrier: (carrier: TargetTypeRef) => originsByKey.get(closedMetadataKey(carrier)),
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
  return Object.freeze({ plan,
    methodStorageFinalized: () => methodStorageFinalized,
    close() {
      if (closed) throw new Error("Rust structural storage seals once.");
      if (!methodStorageFinalized) throw new Error("Rust structural storage requires its complete physical method templates before sealing.");
      if (definitions.some(definition => definition.fields.some(field => field.methodPlan?.kind === "fixed" && field.methodPlan.payload === undefined)))
        throw new Error("A published fixed structural method requires its completed native body and capture environment.");
      closed = true;
    },
    completePhysicalCarrier(source: TargetTypeRef, physical: TargetTypeRef) {
      if (methodStorageFinalized) {
        const selected = definitionFor(physical);
        if (selected === undefined) throw new Error("A completed structural physical carrier must have been admitted before finalization.");
        return physical;
      }
      const sourceKey = closedMetadataKey(source);
      const selected = definitionFor(source);
      const original = originsByKey.get(sourceKey) ?? (selected === undefined ? undefined
        : definitions.find(definition => definition.targetName === selected.targetName && definition.componentId === selected.componentId));
      const value = rustStructuralObjectCarrierValue(physical);
      if (original === undefined || value === undefined || value.implementation !== undefined && value.implementation.kind !== "physical")
        throw new Error("Structural physical completion requires its actual source owner and completed native capture arguments.");
      const values = completedCarriers.get(original) ?? new Map();
      completedCarriers.set(original, values);
      const previous = values.get(sourceKey);
      if (previous !== undefined && !rustTargetTypeRefEquals(previous.carrier, physical))
        throw new Error("A structural source instance has one completed physical implementation and capture environment.");
      if (previous !== undefined) return previous.carrier;
      const carrier = rustStructuralGenericCarrier(physical).carrier;
      const references = rustTargetGenericReferences(carrier);
      const template = Object.freeze({ ...original, carrier,
        genericParameters: Object.freeze([
          ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime: lifetime as Extract<RustLifetimeRef, { kind: "parameter" }> })),
          ...references.typeParameters.map(parameter => ({ kind: "type" as const, identity: parameter.identity, name: parameter.name })),
        ]),
        genericArguments: Object.freeze([
          ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...references.typeParameters.map(type => ({ kind: "type" as const, type })),
        ]),
      });
      values.set(sourceKey, Object.freeze({ source, carrier: physical, template }));
      registerCarrier(template, physical, original);
      publishedInstances = Object.freeze([...byKey.values()]);
      return physical;
    },
    finalizeMethodStorage(selections) {
      if (methodStorageFinalized) throw new Error("Structural method physical storage finalizes exactly once.");
      for (const definition of definitions) {
        if (physicalTemplateFor(definition) !== undefined ||
          rustStructuralObjectCarrierValue(definition.carrier)?.implementation !== undefined ||
          !definition.fields.some(field => field.methodPlan?.kind === "fixed")) continue;
        const matches = definitions.flatMap(candidate => {
          const template = physicalTemplateFor(candidate);
          if (template === undefined || rustStructuralObjectCarrierValue(candidate.carrier)?.implementation === undefined ||
            !definition.fields.every(field => {
              const method = field.methodPlan;
              return method?.kind !== "fixed" || candidate.fields.some(selected => selected.sourceName === field.sourceName &&
                selected.methodPlan?.kind === "fixed" && selected.methodPlan.declaration === method.declaration);
            })) return [];
          const carrier = bindRustStructuralImplementationContract(template.carrier, definition.carrier);
          return carrier === undefined ? [] : [{ template, carrier }];
        });
        if (matches.length !== 1)
          throw new Error("A fixed structural contract requires its one checked complete native implementation template.");
        const selected = matches[0]!;
        const values = new Map<string, { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef;
          readonly template: RustStructuralShapeDefinition }>();
        for (const source of [definition.carrier, ...definition.sourceCarriers]) {
          const carrier = bindRustStructuralImplementationContract(selected.template.carrier, source);
          if (carrier === undefined) throw new Error("A structural contract requires its exact checked native implementation arguments.");
          values.set(closedMetadataKey(source), Object.freeze({ source, carrier, template: selected.template }));
        }
        completedCarriers.set(definition, values);
      }
      const replacements = new Map<RustStructuralShapeDefinition, RustStructuralShapeDefinition>();
      for (const definition of definitions) {
        const fields = selections.get(definition);
        const completed = completedCarriers.get(definition);
        const template = completed?.get(closedMetadataKey(definition.carrier)) ?? definition.sourceCarriers
          .map(source => completed?.get(closedMetadataKey(source))).find(selected => selected !== undefined);
        if (template !== undefined && (template.template.targetName !== definition.targetName ||
          template.template.componentId !== definition.componentId)) continue;
        if (definition.fields.some(field => field.methodPlan?.kind === "fixed") && template === undefined)
          throw new Error("A fixed structural method requires its completed physical template before publication.");
        const carrier = template === undefined ? definition.carrier : rustStructuralGenericCarrier(template.carrier).carrier;
        for (const [index] of fields ?? []) {
          if (definition.fields[index]?.method !== true)
            throw new Error("Structural method storage can replace only an admitted method slot.");
        }
        const selectedFields = Object.freeze(definition.fields.map((field, index) => {
            const selection = fields?.get(index);
            if (selection === undefined) {
              if (field.methodPlan?.kind === "fixed") throw new Error("A fixed structural method requires its complete selected native body before publication.");
              return field;
            }
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
            if (field.methodPlan === undefined) throw new Error("A completed structural method requires its selected native exposure.");
            const physical = rustStructuralObjectCarrierValue(carrier)?.implementation?.methods.find(method => method.sourceName === field.sourceName);
            const declaration = field.methodPlan.kind === "fixed" ? field.methodPlan.declaration : undefined;
            const body = selection.nativeBody;
            if (field.methodPlan.kind === "fixed" && (physical === undefined || body?.declaration !== declaration) ||
              field.methodPlan.kind !== "fixed" && body !== undefined)
              throw new Error("A fixed structural method requires its exact native construction and physical capture environment.");
            let captureIndex = 0;
            const payload = body === undefined || physical === undefined ? undefined : Object.freeze({
              captures: Object.freeze(body.payload.captures.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") throw new Error("A fixed structural method lost its physical capture argument.");
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
              receiverFields: Object.freeze(body.payload.receiverFields.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") throw new Error("A fixed structural method lost its physical receiver-field argument.");
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
              receivers: Object.freeze(body.payload.receivers.map(capture => {
                const argument = physical.genericArguments[captureIndex++];
                if (argument?.kind !== "type") throw new Error("A fixed structural method lost its physical receiver argument.");
                return Object.freeze({ ...capture, storageCarrier: argument.type });
              })),
            });
            if (physical !== undefined && captureIndex !== physical.genericArguments.length)
              throw new Error("A fixed structural method requires its complete physical capture argument inventory.");
            return Object.freeze({ ...field, methodPlan: Object.freeze({ ...field.methodPlan, carrier: selection.carrier,
              ...(payload === undefined ? {} : { payload }),
              constructions: Object.freeze(selection.constructions.map(construction => Object.freeze({ ...construction }))) }),
            });
          }));
        const references = rustTargetGenericReferences(carrier);
        const storedReferences = rustTargetGenericReferences({ kind: "tuple", elements: [
          ...selectedFields.flatMap(field => field.methodPlan?.kind === "fixed" ? [] : [field.methodPlan?.carrier ?? field.carrier]),
          ...(definition.construction === undefined ? [] : [definition.construction.carrier]),
        ] });
        const stateReferences = definition.dispatchName === undefined ? rustTargetGenericReferences({ kind: "tuple", elements: [
          ...selectedFields.flatMap(field => field.methodPlan?.kind === "fixed" && field.methodPlan.payload !== undefined
            ? [...field.methodPlan.payload.captures, ...field.methodPlan.payload.receiverFields, ...field.methodPlan.payload.receivers]
              .map(capture => capture.storageCarrier) : [field.methodPlan?.carrier ?? field.carrier]),
          ...(definition.construction === undefined ? [] : [definition.construction.carrier]),
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
        const completed = completedCarriers.get(definition)?.get(closedMetadataKey(definition.carrier));
        const owner = completed === undefined ? undefined : definitions.find(candidate =>
          candidate.targetName === completed.template.targetName && candidate.componentId === completed.template.componentId);
        const replacement = owner === undefined ? undefined : replacements.get(owner);
        const instance = completed === undefined || replacement === undefined ? undefined
          : instantiateStructuralDefinition(replacement, completed.carrier);
        if (instance === undefined) throw new Error("A structural contract requires its completed actual native implementation owner.");
        replacements.set(definition, instance);
      }
      for (const definition of selections.keys()) {
        if (!replacements.has(definition)) throw new Error("Structural method storage requires its exact canonical definition.");
      }
      const finalDefinitions = Object.freeze(definitions.filter(definition => {
        const template = physicalTemplateFor(definition);
        return template === undefined || template.targetName === definition.targetName && template.componentId === definition.componentId;
      }).map(definition => replacements.get(definition)!));
      const canonical = new Map(finalDefinitions.map(definition => [`${definition.componentId}\0${definition.targetName}`, definition]));
      const canonicalFor = (definition: RustStructuralShapeDefinition): RustStructuralShapeDefinition => {
        const selected = canonical.get(`${definition.componentId}\0${definition.targetName}`);
        if (selected === undefined) throw new Error("A structural physical instance requires its one canonical native implementation owner.");
        return selected;
      };
      const instances = new Map<string, RustStructuralShapeDefinition>();
      for (const [key, selected] of byKey) {
        const origin = originsByKey.get(key);
        const replacement = origin === undefined ? undefined : replacements.get(origin);
        const completed = origin === undefined ? undefined : completedCarriers.get(origin)?.get(key);
        const sourceReferences = origin === undefined ? undefined : rustTargetGenericReferences(origin.carrier);
        const sourceBindings = origin === undefined || sourceReferences === undefined ? undefined
          : inferRustTargetGenericBindings(origin.carrier, selected.carrier, {
            typeIdentities: new Set(sourceReferences.typeIdentities), lifetimeIdentities: new Set(sourceReferences.lifetimeIdentities),
            constIdentities: new Set(sourceReferences.constIdentities),
          });
        const instanceCarrier = completed !== undefined ? completed.carrier : rustStructuralObjectCarrierValue(selected.carrier)?.implementation?.kind === "physical"
          ? selected.carrier : replacement === undefined || sourceBindings === undefined
          ? undefined : substituteRustTargetGenerics(replacement.carrier, sourceBindings.types, sourceBindings.lifetimes, sourceBindings.consts);
        const instance = replacement === undefined || instanceCarrier === undefined ? undefined : instantiateStructuralDefinition(replacement, instanceCarrier);
        if (instance === undefined) throw new Error("Structural physical storage lost its exact template-to-instance correspondence.");
        instances.set(key, instance);
      }
      for (const [key, selected] of instances) byKey.set(key, selected);
      for (const [key, definition] of byStorageKey) byStorageKey.set(key, canonicalFor(replacements.get(definition)!));
      for (const [key, definition] of originsByKey) originsByKey.set(key, canonicalFor(replacements.get(definition)!));
      definitions = finalDefinitions;
      for (const [original, completed] of completedCarriers) for (const selected of completed.values()) {
        const replacement = canonicalFor(replacements.get(original)!);
        registerCarrier(replacement, selected.carrier, replacement);
      }
      publishedInstances = Object.freeze([...byKey.values()]);
      methodStorageFinalized = true;
    },
  });
}
