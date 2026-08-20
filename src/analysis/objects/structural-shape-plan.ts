import type { TargetTypeRef } from "../../policy/types/model.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { closedMetadataKey } from "../../policy/model/closed-data.js";
import {
  rustPascalCaseIdentifier,
  rustSnakeCaseIdentifier,
} from "../../policy/names/identifiers.js";
import {
  rustStructuralObjectCarrierValue,
  rustTargetTypeParameterNames,
} from "../../policy/types/target-types.js";
import type {
  RustSourceObjectShape,
  RustStructuralFieldImplementation,
} from "../project-types/source-type-registry.js";

export interface RustStructuralShapeField {
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
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly typeParameterNames: readonly string[];
  readonly fields: readonly RustStructuralShapeField[];
}

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
    ) {
      if (current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      current = createRustStructuralShapePlan(shapes, implementations, componentForFile);
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
): RustStructuralShapePlan {
  const uniqueByKey = new Map<string, TargetTypeRef>();
  for (const shape of shapes) {
    const structural = rustStructuralObjectCarrierValue(shape.carrier);
    if (structural === undefined) {
      continue;
    }
    const key = closedMetadataKey(shape.carrier);
    const existing = uniqueByKey.get(key);
    if (existing === undefined) {
      uniqueByKey.set(key, shape.carrier);
    } else if (!rustTargetTypeRefEquals(existing, shape.carrier)) {
      throw new Error("Rust structural carrier canonicalization produced a non-injective identity.");
    }
  }
  const usedTypeNamesByComponent = new Map<string, Set<string>>();
  const definitions = [...uniqueByKey]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, carrier]): RustStructuralShapeDefinition => {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural === undefined) {
        throw new Error("Rust structural shape plan contains a non-structural carrier.");
      }
      const componentId = componentForFile(structural.ownerFileName);
      const usedTypeNames = usedTypeNamesByComponent.get(componentId) ?? new Set<string>();
      usedTypeNamesByComponent.set(componentId, usedTypeNames);
      const usedFieldNames = new Set<string>();
      const fields = structural.fields.map((field, storageIndex): RustStructuralShapeField => {
        const targetName = allocateSnakeName(
          usedFieldNames,
          rustSnakeCaseIdentifier(field.sourceName),
        );
        const fieldImplementations = implementations.filter((implementation) =>
          implementation.storageIndex === storageIndex &&
          rustTargetTypeRefEquals(implementation.carrier, carrier));
        const propertyStorage = field.accessor !== undefined ||
          fieldImplementations.some((implementation) => implementation.kind === "accessor");
        return Object.freeze({
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
      return Object.freeze({
        carrier,
        ownerFileName: structural.ownerFileName,
        componentId,
        targetName: allocatePascalName(usedTypeNames, preferredShapeName(fields)),
        typeParameterNames: rustTargetTypeParameterNames(carrier),
        fields: Object.freeze(fields),
      });
    });
  const byKey = new Map(definitions.map((definition) =>
    [closedMetadataKey(definition.carrier), definition] as const));
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
