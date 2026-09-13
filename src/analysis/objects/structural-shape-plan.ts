import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustStructuralInstantiation } from "../../policy/types/source-type-registry.js";
import type { RustNativeMemoryLayout, RustNativeObjectField } from "../../target-model/operations/native-memory.js";
import { rustNativeMemoryLayoutsEqual } from "../../target-model/operations/native-memory.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import {
  rustPascalCaseIdentifier,
  rustSnakeCaseIdentifier,
} from "../../target-model/names/identifiers.js";
import {
  rustStructuralObjectCarrierValue,
  rustTargetGenericReferences,
} from "../../target-model/types/index.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { visitRustTargetTypeParameters } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import type {
  RustSourceObjectShape,
  RustStructuralFieldImplementation,
} from "../project-types/source-type-registry.js";

export interface RustStructuralShapeField {
  readonly nativeLayout?: RustNativeMemoryLayout;
  readonly sourceName: string;
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
  readonly presence: "required" | "optional";
  readonly readonly: boolean;
  readonly storage: "stored" | "property";
  readonly property?: {
    readonly getterTargetName: string;
    readonly setterTargetName?: string;
  };
  readonly method?: true;
}

export interface RustStructuralShapeDefinition {
  readonly carrier: TargetTypeRef;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly genericParameters: readonly RustStructuralShapeGenericParameter[];
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly fields: readonly RustStructuralShapeField[];
}

export type RustStructuralShapeGenericParameter =
  | {
      readonly kind: "lifetime";
      readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
    }
  | { readonly kind: "type"; readonly name: string };

export interface RustStructuralShapePlan {
  readonly definitions: readonly RustStructuralShapeDefinition[];
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined;
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
  ): RustStructuralShapePlan;
  isInitialized(): boolean;
  seal(): RustStructuralShapePlan;
}

export function createRustStructuralShapePlanRegistry(): RustStructuralShapePlanRegistry {
  let current: RustStructuralShapePlan | undefined;
  const requireCurrent = (): RustStructuralShapePlan => {
    if (current === undefined) {
      throw new Error("Rust structural shape plan was read before source analysis initialized it.");
    }
    return current;
  };
  return Object.freeze({
    initialize(
      shapes: readonly RustSourceObjectShape[],
      implementations: readonly RustStructuralFieldImplementation[],
      componentForFile: (fileName: string) => string,
      nativeFields: readonly RustNativeObjectField[],
      instantiations: readonly RustStructuralInstantiation[],
    ) {
      if (current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      current = createRustStructuralShapePlan(shapes, implementations, componentForFile, nativeFields, instantiations);
      return current;
    },
    isInitialized() {
      return current !== undefined;
    },
    seal() {
      return requireCurrent();
    },
    get definitions() {
      return requireCurrent().definitions;
    },
    definitionForCarrier(carrier: TargetTypeRef | undefined) {
      return requireCurrent().definitionForCarrier(carrier);
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
): RustStructuralShapePlan {
  const uniqueByKey = new Map<string, Map<string, TargetTypeRef>>();
  for (const shape of shapes) {
    const structural = rustStructuralObjectCarrierValue(shape.carrier);
    if (structural === undefined) {
      continue;
    }
    const key = structuralStorageKey(shape.carrier);
    const instances = uniqueByKey.get(key) ?? new Map<string, TargetTypeRef>();
    uniqueByKey.set(key, instances);
    const instanceKey = closedMetadataKey(shape.carrier);
    const existing = instances.get(instanceKey);
    if (existing === undefined) {
      instances.set(instanceKey, shape.carrier);
    } else if (!rustTargetTypeRefEquals(existing, shape.carrier)) {
      throw new Error("Rust structural carrier canonicalization produced a non-injective identity.");
    }
  }
  const roots = new Map<string, string>();
  for (const { template, instance } of instantiations) {
    const templateKey = structuralStorageKey(template);
    const instanceKey = structuralStorageKey(instance);
    if (templateKey === instanceKey) continue;
    const prior = roots.get(instanceKey);
    if (prior !== undefined && prior !== templateKey) {
      throw new Error("Rust structural instantiation has contradictory storage templates.");
    }
    roots.set(instanceKey, templateKey);
  }
  const rootFor = (key: string): string => {
    const visited = new Set<string>();
    while (roots.has(key)) {
      if (visited.has(key)) throw new Error("Rust structural instantiation has cyclic storage templates.");
      visited.add(key);
      key = roots.get(key)!;
    }
    return key;
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
  const definitions = [...grouped]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, instances]): RustStructuralShapeDefinition => {
      const sourceCarriers = Object.freeze([...instances]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, carrier]) => carrier));
      const carrier = [...uniqueByKey.get(key)!].sort(([left], [right]) => left.localeCompare(right, "en"))[0]![1];
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural === undefined) {
        throw new Error("Rust structural shape plan contains a non-structural carrier.");
      }
      const componentId = componentForFile(structural.ownerFileName);
      const usedTypeNames = usedTypeNamesByComponent.get(componentId) ?? new Set<string>();
      usedTypeNamesByComponent.set(componentId, usedTypeNames);
      const usedFieldNames = new Set<string>();
      const fields = structural.fields.map((field, storageIndex): RustStructuralShapeField => {
        const selectedNativeFields = nativeFields.filter(candidate => candidate.storageIndex === storageIndex &&
          instances.has(closedMetadataKey(candidate.owner)));
        const nativeLayout = selectedNativeFields[0]?.layout;
        if (nativeLayout !== undefined && selectedNativeFields.some(candidate =>
          !rustNativeMemoryLayoutsEqual(candidate.layout, nativeLayout))) {
          throw new Error("Equivalent Rust structural carriers have contradictory native field layouts.");
        }
        const targetName = allocateSnakeName(
          usedFieldNames,
          rustSnakeCaseIdentifier(field.sourceName),
        );
        const fieldImplementations = implementations.filter((implementation) =>
          implementation.storageIndex === storageIndex &&
          instances.has(closedMetadataKey(implementation.carrier)));
        const propertyStorage = field.accessor !== undefined ||
          fieldImplementations.some((implementation) => implementation.kind === "accessor");
        return Object.freeze({
          ...(nativeLayout === undefined ? {} : { nativeLayout }),
          sourceName: field.sourceName,
          targetName,
          carrier: field.type,
          presence: field.presence,
          readonly: field.readonly,
          storage: propertyStorage ? "property" as const : "stored" as const,
          ...(!propertyStorage
            ? {}
            : {
                property: Object.freeze({
                  getterTargetName: allocateSnakeName(
                    usedFieldNames,
                    `get_${targetName}`,
                  ),
                  ...(!field.readonly
                    ? {
                        setterTargetName: allocateSnakeName(
                          usedFieldNames,
                          `set_${targetName}`,
                        ),
                      }
                    : {}),
                }),
              }),
          ...(field.method === true ? { method: true as const } : {}),
        });
      });
      const genericReferences = rustTargetGenericReferences(carrier);
      if (genericReferences.constIdentities.length !== 0 ||
        genericReferences.lifetimes.some((lifetime) => lifetime.kind !== "parameter")) {
        throw new Error("Rust structural source shapes cannot capture const or higher-ranked generic parameters.");
      }
      return Object.freeze({
        carrier,
        sourceCarriers,
        ownerFileName: structural.ownerFileName,
        componentId,
        targetName: allocatePascalName(usedTypeNames, preferredShapeName(fields)),
        genericParameters: Object.freeze([
          ...genericReferences.lifetimes.map((lifetime) => Object.freeze({
            kind: "lifetime" as const,
            lifetime: lifetime as Extract<RustLifetimeRef, { readonly kind: "parameter" }>,
          })),
          ...genericReferences.typeNames.map((name) => Object.freeze({
            kind: "type" as const,
            name,
          })),
        ]),
        genericArguments: Object.freeze([
          ...genericReferences.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
          ...genericReferences.typeNames.map(name => ({ kind: "type" as const, type: { kind: "type-parameter" as const, name } })),
        ]),
        fields: Object.freeze(fields),
      });
    });
  const byKey = new Map(definitions.flatMap((definition) =>
    definition.sourceCarriers.map((carrier) =>
      [closedMetadataKey(carrier), instantiateStructuralDefinition(definition, carrier)] as const)));
  return Object.freeze({
    definitions: Object.freeze(definitions),
    definitionForCarrier(carrier: TargetTypeRef | undefined) {
      if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) {
        return undefined;
      }
      const definition = byKey.get(closedMetadataKey(carrier));
      return definition !== undefined && rustTargetTypeRefEquals(definition.carrier, carrier)
        ? definition
        : undefined;
    },
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      return Number.isSafeInteger(storageIndex) && storageIndex >= 0
        ? byKey.get(closedMetadataKey(carrier))?.fields[storageIndex]?.targetName
        : undefined;
    },
    field(carrier: TargetTypeRef, storageIndex: number) {
      if (!Number.isSafeInteger(storageIndex) || storageIndex < 0) {
        return undefined;
      }
      const definition = byKey.get(closedMetadataKey(carrier));
      return definition !== undefined && rustTargetTypeRefEquals(definition.carrier, carrier)
        ? definition.fields[storageIndex]
        : undefined;
    },
  });
}

function structuralStorageKey(carrier: TargetTypeRef): string {
  const substitutions = new Map<string, TargetTypeRef>();
  visitRustTargetTypeParameters(carrier, (name) => {
    if (!substitutions.has(name)) {
      substitutions.set(name, { kind: "type-parameter", name: `ShapeParameter${substitutions.size}` });
    }
    return false;
  });
  return closedMetadataKey(substituteRustTargetTypeParameters(carrier, substitutions));
}

function instantiateStructuralDefinition(
  definition: RustStructuralShapeDefinition,
  carrier: TargetTypeRef,
): RustStructuralShapeDefinition {
  if (rustTargetTypeRefEquals(definition.carrier, carrier)) {
    return definition;
  }
  const parameters = new Set(definition.genericParameters.flatMap(parameter =>
    parameter.kind === "type" ? [parameter.name] : []));
  const bindings = inferRustTargetTypeParameterBindings(definition.carrier, carrier, parameters);
  if (bindings === undefined || bindings.size !== parameters.size ||
    !rustTargetTypeRefEquals(substituteRustTargetTypeParameters(definition.carrier, bindings), carrier)) {
    throw new Error("Rust structural storage requires an exact generic-parameter correspondence.");
  }
  return Object.freeze({
    ...definition,
    carrier,
    genericArguments: Object.freeze(definition.genericArguments.map(argument => {
      if (argument.kind !== "type") return argument;
      return Object.freeze({ kind: "type" as const, type: substituteRustTargetTypeParameters(argument.type, bindings) });
    })),
    fields: Object.freeze(definition.fields.map(field => Object.freeze({
      ...field,
      carrier: substituteRustTargetTypeParameters(field.carrier, bindings),
    }))),
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
