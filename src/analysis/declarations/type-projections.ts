import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement } from "./generic-requirements.js";
import type { RustOptionalStorageProjection } from "../../target-model/types/projections.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";

export interface RustOptionalStorageRequirement {
  readonly carrier: RustOptionalStorageProjection;
  readonly captured: boolean;
  readonly requirements: readonly RustGenericRequirement[];
}

export function createRustOptionalStorageCollector(
  own: ReadonlySet<string>,
  declared: Set<string>,
  requirements: Map<string, Set<RustGenericRequirement>>,
): {
  collect(type: TargetTypeRef): boolean;
  seal(): readonly RustOptionalStorageRequirement[];
} {
  const projections = new Map<string, RustOptionalStorageProjection>();
  const collect = (type: TargetTypeRef): boolean => {
    if (type.kind === "type-parameter" && type.optionalStorageValue !== undefined) {
      const names = rustTargetTypeParameterNames(type.optionalStorageValue);
      if (names.length === 0 || names.some(name => !declared.has(name))) return false;
      projections.set(type.name, type as RustOptionalStorageProjection);
      declared.add(type.name);
      if (!requirements.has(type.name)) requirements.set(type.name, new Set());
    }
    return rustTargetTypeChildren(type).every(collect);
  };
  return {
    collect,
    seal: () => Object.freeze([...projections.values()].sort((left, right) => left.name.localeCompare(right.name))
      .map(carrier => Object.freeze({ carrier,
        captured: !rustTargetTypeParameterNames(carrier.optionalStorageValue).some(name => own.has(name)),
        requirements: Object.freeze([...(requirements.get(carrier.name) ?? [])].sort()),
      }))),
  };
}
