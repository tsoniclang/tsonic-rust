import type { RustStructuralShapeField, RustStructuralShapeDefinition, RustStructuralShapeGenericParameter, RustStructuralMethodConstruction, RustStructuralMethodStorageSelection } from "../../target-model/records/structural-shapes.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { Node } from "@tsonic/tsts";
import { rustPropertyStorageNames } from "../../target-model/names/property-storage.js";
import type { RustStructuralInstantiation } from "../../policy/types/model/source-type-registry.js";
import type { RustSourceUnionDefinition } from "../../target-model/types/source-union-definitions.js";
import { createRustGeneratedUnionPlan, type RustGeneratedUnionPlan } from "./generated-union-plan.js";
import type { RustNativeMemoryLayout, RustNativeObjectField } from "../../target-model/operations/native-memory.js";
import { rustNativeMemoryLayoutsEqual } from "../../target-model/operations/native-memory.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import {
  rustPascalCaseIdentifier,
} from "../../target-model/names/identifiers.js";
import {
  rustStructuralObjectCarrierValue,
  rustStructuralObjectTargetType,
  rustTargetGenericReferences,
  rustStructuralMethodStorageCarrier,
  rustOptionElementCarrier,
  rustCallableProtocol,
} from "../../target-model/types/index.js";
import { rustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { visitRustTargetTypeParameters } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustStructuralGenericCarrier } from "./structural-generic-carrier.js";
import type {
  RustSourceObjectShape,
  RustStructuralFieldImplementation,
} from "../project-types/source-type-registry.js";

export function rustStructuralFieldIsFallible(field: Pick<RustStructuralShapeField, "storage"> | undefined): boolean {
  return field !== undefined && field.storage !== "stored";
}

export interface RustStructuralShapePlan extends RustGeneratedUnionPlan {
  readonly definitions: readonly RustStructuralShapeDefinition[];
  readonly instances: readonly RustStructuralShapeDefinition[];
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined;
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
    receiverIndependentMethods?: ReadonlySet<string>,
  ): RustStructuralShapePlan;
  initializeUnions(unions: readonly RustSourceUnionDefinition[]): void;
  finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeDefinition,
    ReadonlyMap<number, RustStructuralMethodStorageSelection>>): void;
  isInitialized(): boolean;
  seal(): RustStructuralShapePlan;
}

export function createRustStructuralShapePlanRegistry(): RustStructuralShapePlanRegistry {
  let current: RustStructuralShapePlan | undefined;
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
      receiverIndependentMethods: ReadonlySet<string> = new Set(),
    ) {
      if (current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      componentForFile = selectComponent;
      construction = createRustStructuralShapeConstruction(shapes, implementations, selectComponent, nativeFields, instantiations, {
        get unionDefinitions() { return requireUnions().unionDefinitions; },
        unionForCarrier: (carrier: TargetTypeRef) => requireUnions().unionForCarrier(carrier),
      }, receiverIndependentMethods);
      current = construction.plan;
      return current;
    },
    initializeUnions(definitions: readonly RustSourceUnionDefinition[]) {
      const shapes = requireCurrent();
      if (unions !== undefined || componentForFile === undefined)
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
    finalizeMethodStorage(selections: ReadonlyMap<RustStructuralShapeDefinition,
      ReadonlyMap<number, RustStructuralMethodStorageSelection>>) {
      if (construction === undefined) throw new Error("Structural method storage requires its initialized shape builder.");
      construction.finalizeMethodStorage(selections);
    },
    isInitialized() {
      return current !== undefined;
    },
    seal() {
      requireUnions();
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
  instantiations: readonly RustStructuralInstantiation[] = [],
  unions: RustGeneratedUnionPlan = createRustGeneratedUnionPlan([], componentForFile, new Map()),
  receiverIndependentMethods: ReadonlySet<string> = new Set(),
): RustStructuralShapePlan {
  return createRustStructuralShapeConstruction(shapes, implementations, componentForFile, nativeFields,
    instantiations, unions, receiverIndependentMethods).plan;
}

function createRustStructuralShapeConstruction(
  shapes: readonly RustSourceObjectShape[],
  implementations: readonly RustStructuralFieldImplementation[],
  componentForFile: (fileName: string) => string,
  nativeFields: readonly RustNativeObjectField[],
  instantiations: readonly RustStructuralInstantiation[],
  unions: RustGeneratedUnionPlan,
  receiverIndependentMethods: ReadonlySet<string>,
): {
  readonly plan: RustStructuralShapePlan;
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
        return Object.freeze({
          ...(nativeLayout === undefined ? {} : { nativeLayout }),
          sourceName: field.sourceName,
          targetName,
          carrier: field.type,
          presence: field.presence,
          readonly: field.readonly,
          storage: field.bound === true ? "bound" as const : propertyStorage ? "property" as const : "stored" as const,
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
          ...(methodStorageCarrier === undefined ? {} : { methodStorageCarrier }),
          ...(field.method === true && nativeDispatch ? { nativeMethod: true as const } : {}),
          ...(independent
            ? { receiverIndependent: true as const } : {}),
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
        fields: Object.freeze(fields),
        ...(structural.construction === undefined ? {} : { construction: Object.freeze({
          targetName: allocateSnakeName(usedFieldNames, "construct"), carrier: structural.construction,
        }) }),
      });
    }));
  const byKey = new Map<string, RustStructuralShapeDefinition>();
  const byStorageKey = new Map<string, RustStructuralShapeDefinition>();
  const originsByKey = new Map<string, RustStructuralShapeDefinition>();
  const registerCarrier = (definition: RustStructuralShapeDefinition, carrier: TargetTypeRef): void => {
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
    byStorageKey.set(storageKey, definition);
    originsByKey.set(key, definition);
  };
  for (const definition of definitions) {
    for (const carrier of definition.sourceCarriers) registerCarrier(definition, carrier);
    registerCarrier(definition, definition.carrier);
  }
  for (const nested of nestedCarriers) {
    const definition = originsByKey.get(closedMetadataKey(nested.source));
    if (definition === undefined) {
      throw new Error("Nested Rust structural storage is missing its checked source definition.");
    }
    registerCarrier(definition, nested.carrier);
  }
  const definitionFor = (carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined => {
    if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) return undefined;
    const key = closedMetadataKey(carrier);
    return byKey.get(key);
  };
  const plan: RustStructuralShapePlan = Object.freeze({
    get unionDefinitions() { return unions.unionDefinitions; },
    unionForCarrier: (carrier: TargetTypeRef) => unions.unionForCarrier(carrier),
    get definitions() { return definitions; },
    get instances() { return Object.freeze([...byKey.values()]); },
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
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      return Number.isSafeInteger(storageIndex) && storageIndex >= 0
        ? definitionFor(carrier)?.fields[storageIndex]?.targetName
        : undefined;
    },
    field(carrier: TargetTypeRef, storageIndex: number) {
      if (!Number.isSafeInteger(storageIndex) || storageIndex < 0) {
        return undefined;
      }
      return definitionFor(carrier)?.fields[storageIndex];
    },
  });
  let methodStorageFinalized = false;
  return Object.freeze({ plan,
    finalizeMethodStorage(selections) {
      if (methodStorageFinalized) throw new Error("Structural method physical storage finalizes exactly once.");
      const replacements = new Map<RustStructuralShapeDefinition, RustStructuralShapeDefinition>();
      for (const definition of definitions) {
        const fields = selections.get(definition);
        if (fields === undefined) {
          replacements.set(definition, definition);
          continue;
        }
        for (const [index] of fields) {
          if (definition.fields[index]?.method !== true)
            throw new Error("Structural method storage can replace only an admitted method slot.");
        }
        replacements.set(definition, Object.freeze({ ...definition,
          fields: Object.freeze(definition.fields.map((field, index) => {
            const selection = fields.get(index);
            if (selection === undefined) return field;
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
            return Object.freeze({ ...field, methodStorageCarrier: selection.carrier,
              methodConstructions: Object.freeze(selection.constructions.map(construction => Object.freeze({ ...construction }))),
            });
          })),
        }));
      }
      for (const definition of selections.keys()) {
        if (!replacements.has(definition)) throw new Error("Structural method storage requires its exact canonical definition.");
      }
      const instances = new Map<string, RustStructuralShapeDefinition>();
      for (const [key, selected] of byKey) {
        const origin = originsByKey.get(key) ?? byStorageKey.get(structuralStorageKey(selected.carrier, componentForFile));
        const replacement = origin === undefined ? undefined : replacements.get(origin);
        const instance = replacement === undefined ? undefined : instantiateStructuralDefinition(replacement, selected.carrier);
        if (instance === undefined) throw new Error("Structural physical storage lost its exact template-to-instance correspondence.");
        instances.set(key, instance);
      }
      for (const [key, selected] of instances) byKey.set(key, selected);
      for (const [key, definition] of byStorageKey) byStorageKey.set(key, replacements.get(definition)!);
      for (const [key, definition] of originsByKey) originsByKey.set(key, replacements.get(definition)!);
      definitions = Object.freeze(definitions.map(definition => replacements.get(definition)!));
      methodStorageFinalized = true;
    },
  });
}

export function structuralStorageKey(carrier: TargetTypeRef, componentForFile: (fileName: string) => string): string {
  const substitutions = new Map<string, TargetTypeRef>();
  visitRustTargetTypeParameters(carrier, (parameter) => {
    if (!substitutions.has(parameter.identity)) {
      substitutions.set(parameter.identity, { kind: "type-parameter", identity: `structural-shape:${substitutions.size}`, name: `ShapeParameter${substitutions.size}` });
    }
    return false;
  });
  const normalized = substituteRustTargetTypeParameters(carrier, substitutions);
  const shape = rustStructuralObjectCarrierValue(normalized);
  return closedMetadataKey(shape === undefined ? normalized :
    rustStructuralObjectTargetType(componentForFile(shape.ownerFileName), shape.fields, shape.representation, shape.construction, shape.bases));
}

function instantiateStructuralDefinition(
  definition: RustStructuralShapeDefinition,
  carrier: TargetTypeRef,
): RustStructuralShapeDefinition | undefined {
  if (rustTargetTypeRefEquals(definition.carrier, carrier)) {
    return definition;
  }
  const parameters = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "type" ? [parameter.identity] : []));
  const lifetimes = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
  const shape = rustStructuralObjectCarrierValue(carrier);
  const aligned = shape === undefined ? carrier : rustStructuralObjectTargetType(definition.ownerFileName, shape.fields, shape.representation, shape.construction, shape.bases);
  const bindings = inferRustTargetGenericBindings(definition.carrier, aligned, {
    typeIdentities: parameters, lifetimeIdentities: lifetimes, constIdentities: new Set(),
  });
  const substitute = (type: TargetTypeRef) => bindings === undefined ? type :
    substituteRustTargetGenerics(type, bindings.types, bindings.lifetimes, bindings.consts);
  if (bindings === undefined || bindings.types.size !== parameters.size || bindings.lifetimes.size !== lifetimes.size ||
    !rustTargetTypeRefEquals(substitute(definition.carrier), aligned)) {
    return undefined;
  }
  return Object.freeze({
    ...definition,
    carrier,
    genericArguments: Object.freeze(definition.genericArguments.map(argument => {
      if (argument.kind === "lifetime") return Object.freeze({ kind: "lifetime" as const,
        lifetime: bindings.lifetimes.get(rustLifetimeKey(argument.lifetime)) ?? argument.lifetime });
      if (argument.kind !== "type") return argument;
      return Object.freeze({ kind: "type" as const, type: substitute(argument.type) });
    })),
    fields: Object.freeze(definition.fields.map(field => Object.freeze({
      ...field,
      carrier: substitute(field.carrier),
      ...(field.methodStorageCarrier === undefined ? {} : {
        methodStorageCarrier: substitute(field.methodStorageCarrier),
      }),
      ...(field.methodConstructions === undefined ? {} : {
        methodConstructions: Object.freeze(field.methodConstructions.map(construction => Object.freeze({ ...construction,
          physicalCarrier: substitute(construction.physicalCarrier),
          destinationCarrier: substitute(construction.destinationCarrier),
        }))),
      }),
    }))),
    ...(definition.construction === undefined ? {} : { construction: Object.freeze({
      ...definition.construction, carrier: substitute(definition.construction.carrier),
    }) }),
  });
}

function preferredShapeName(fields: readonly RustStructuralShapeField[]): string {
  if (fields.length === 0) {
    return "EmptyObjectShape";
  }
  const selected = fields.slice(0, 3).map((field) =>
    rustPascalCaseIdentifier(field.sourceName));
  const suffix = fields.length <= 3 ? "" : `And${fields.length - 3}More`;
  const candidate = `${selected.join("")}${suffix}Shape`;
  return candidate.length <= 80
    ? candidate
    : `${selected[0] ?? "Object"}ObjectShape`;
}

function allocateSnakeName(usedNames: Set<string>, preferred: string): string {
  let candidate = preferred;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function allocatePascalName(usedNames: Set<string>, preferred: string): string {
  let candidate = preferred;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${preferred}${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}
