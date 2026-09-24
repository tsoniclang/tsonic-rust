import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences, rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";

export interface RustStructuralGenericCarrierSelection {
  readonly carrier: TargetTypeRef;
  readonly nestedCarriers: readonly {
    readonly source: TargetTypeRef;
    readonly carrier: TargetTypeRef;
  }[];
}

export function rustStructuralGenericCarrier(carrier: TargetTypeRef): RustStructuralGenericCarrierSelection {
  const used = new Set(rustTargetGenericReferences(carrier).typeNames);
  if (used.size === 0) return Object.freeze({ carrier, nestedCarriers: Object.freeze([]) });
  const parameters = new Map<string, TargetTypeRef>();
  const nestedCarriers: { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef }[] = [];
  const selected = mapRustTargetTypes(carrier, (type, source) => {
    if (source !== carrier && rustStructuralObjectCarrierValue(source) !== undefined) {
      nestedCarriers.push(Object.freeze({ source, carrier: type }));
    }
    if (!(type.kind === "associated-type" || type.kind === "type-parameter" && type.optionalStorageValue !== undefined) ||
      rustTargetTypeParameterNames(type).length === 0) return type;
    const key = closedMetadataKey(type);
    const existing = parameters.get(key);
    if (existing !== undefined) return existing;
    let index = parameters.size;
    while (used.has(`Storage${index}`)) index += 1;
    const name = `Storage${index}`;
    used.add(name);
    const parameter = { kind: "type-parameter" as const, name };
    parameters.set(key, parameter);
    return parameter;
  });
  return Object.freeze({ carrier: parameters.size === 0 ? carrier : selected,
    nestedCarriers: Object.freeze(parameters.size === 0 ? [] : nestedCarriers) });
}
