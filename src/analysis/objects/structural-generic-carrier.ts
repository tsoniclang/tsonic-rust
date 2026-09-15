import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences, rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";

export function rustStructuralGenericCarrier(carrier: TargetTypeRef): TargetTypeRef {
  const used = new Set(rustTargetGenericReferences(carrier).typeNames);
  if (used.size === 0) return carrier;
  const parameters = new Map<string, TargetTypeRef>();
  const selected = mapRustTargetTypes(carrier, type => {
    if (type.kind !== "associated-type" || rustTargetTypeParameterNames(type).length === 0) return type;
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
  return parameters.size === 0 ? carrier : selected;
}
