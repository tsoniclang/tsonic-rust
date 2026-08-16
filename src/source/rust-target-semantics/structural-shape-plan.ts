import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import {
  rustPascalCaseIdentifier,
  rustSnakeCaseIdentifier,
} from "../../common/rust-identifiers.js";
import {
  rustStructuralObjectCarrierValue,
  rustTargetTypeParameterNames,
} from "../rust-target-types.js";
import type { RustSourceObjectShape } from "./source-type-registry.js";

export interface RustStructuralShapeField {
  readonly sourceName: string;
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
}

export interface RustStructuralShapeDefinition {
  readonly carrier: TargetTypeRef;
  readonly targetName: string;
  readonly typeParameterNames: readonly string[];
  readonly fields: readonly RustStructuralShapeField[];
}

export interface RustStructuralShapePlan {
  readonly definitions: readonly RustStructuralShapeDefinition[];
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustStructuralShapeDefinition | undefined;
  fieldName(carrier: TargetTypeRef, storageIndex: number): string | undefined;
}

export interface RustStructuralShapePlanRegistry extends RustStructuralShapePlan {
  initialize(shapes: readonly RustSourceObjectShape[]): RustStructuralShapePlan;
  isInitialized(): boolean;
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
    initialize(shapes: readonly RustSourceObjectShape[]) {
      if (current !== undefined) {
        throw new Error("Rust structural shape plan can be initialized only once.");
      }
      current = createRustStructuralShapePlan(shapes);
      return current;
    },
    isInitialized() {
      return current !== undefined;
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
  });
}

export function createRustStructuralShapePlan(
  shapes: readonly RustSourceObjectShape[],
): RustStructuralShapePlan {
  const uniqueByKey = new Map<string, TargetTypeRef>();
  for (const shape of shapes) {
    const structural = rustStructuralObjectCarrierValue(shape.carrier);
    if (structural === undefined) {
      continue;
    }
    const key = stableValueKey(shape.carrier);
    const existing = uniqueByKey.get(key);
    if (existing === undefined) {
      uniqueByKey.set(key, shape.carrier);
    } else if (!rustTargetTypeRefEquals(existing, shape.carrier)) {
      throw new Error("Rust structural carrier canonicalization produced a non-injective identity.");
    }
  }
  const usedTypeNames = new Set<string>();
  const definitions = [...uniqueByKey]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, carrier]): RustStructuralShapeDefinition => {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural === undefined) {
        throw new Error("Rust structural shape plan contains a non-structural carrier.");
      }
      const usedFieldNames = new Set<string>();
      const fields = structural.fields.map((field): RustStructuralShapeField => Object.freeze({
        sourceName: field.sourceName,
        targetName: allocateSnakeName(usedFieldNames, rustSnakeCaseIdentifier(field.sourceName)),
        carrier: field.type,
      }));
      return Object.freeze({
        carrier,
        targetName: allocatePascalName(usedTypeNames, preferredShapeName(fields)),
        typeParameterNames: rustTargetTypeParameterNames(carrier),
        fields: Object.freeze(fields),
      });
    });
  const byKey = new Map(definitions.map((definition) =>
    [stableValueKey(definition.carrier), definition] as const));
  return Object.freeze({
    definitions: Object.freeze(definitions),
    definitionForCarrier(carrier: TargetTypeRef | undefined) {
      if (carrier === undefined || rustStructuralObjectCarrierValue(carrier) === undefined) {
        return undefined;
      }
      const definition = byKey.get(stableValueKey(carrier));
      return definition !== undefined && rustTargetTypeRefEquals(definition.carrier, carrier)
        ? definition
        : undefined;
    },
    fieldName(carrier: TargetTypeRef, storageIndex: number) {
      return Number.isSafeInteger(storageIndex) && storageIndex >= 0
        ? byKey.get(stableValueKey(carrier))?.fields[storageIndex]?.targetName
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

function stableValueKey(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableValueKey).join(",")}]`;
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? `n:${String(value)}` : "n:invalid";
    case "string":
      return `s:${value.length}:${value}`;
    case "object": {
      const object = value as Readonly<Record<string, unknown>>;
      return `{${Object.keys(object).sort().map((key) =>
        `${key.length}:${key}=${stableValueKey(object[key])}`).join(",")}}`;
    }
    case "undefined":
      return "undefined";
    default:
      throw new Error("Rust carrier identity contains a non-data value.");
  }
}
