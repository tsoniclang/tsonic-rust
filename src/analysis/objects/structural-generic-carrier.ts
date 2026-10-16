import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences, rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
import { rustOwnedStorageChild } from "../../policy/types/storage/owned-storage.js";

export interface RustStructuralGenericCarrierSelection {
  readonly carrier: TargetTypeRef;
  readonly nestedCarriers: readonly {
    readonly source: TargetTypeRef;
    readonly carrier: TargetTypeRef;
  }[];
}

export function rustStructuralGenericCarrier(carrier: TargetTypeRef): RustStructuralGenericCarrierSelection {
  const references = rustTargetGenericReferences(carrier);
  const used = new Set(references.typeParameters.map(parameter => parameter.name));
  const lifetimeNames = new Set(references.lifetimes.map(parameter => parameter.name));
  let lifetimeCount = 0;
  const storageLifetime = () => {
    let index = lifetimeCount++;
    while (lifetimeNames.has(`storage${index}`)) index += 1;
    const name = `storage${index}`;
    lifetimeNames.add(name);
    return { kind: "parameter" as const, identity: `structural-storage-lifetime:${index}`, name };
  };
  const parameters = new Map<string, TargetTypeRef>();
  const nestedCarriers: { readonly source: TargetTypeRef; readonly carrier: TargetTypeRef }[] = [];
  const selected = mapRustTargetTypes(carrier, (type, source) => {
    const callable = rustCallableProtocol(type);
    if (callable?.lifetime?.kind === "placeholder") {
      type = rustCallableTargetType(callable.parameters, callable.result, storageLifetime());
    }
    if (source !== carrier && rustStructuralObjectCarrierValue(source) !== undefined) {
      nestedCarriers.push(Object.freeze({ source, carrier: type }));
    }
    if (!(type.kind === "associated-type" || type.kind === "type-parameter" && type.optionalStorageValue !== undefined) ||
      rustTargetTypeParameterIdentities(type).length === 0) return type;
    const key = closedMetadataKey(type);
    const existing = parameters.get(key);
    if (existing !== undefined) return existing;
    let index = parameters.size;
    while (used.has(`Storage${index}`)) index += 1;
    const name = `Storage${index}`;
    used.add(name);
    const parameter = { kind: "type-parameter" as const, identity: `structural-storage:${key}`, name };
    parameters.set(key, parameter);
    return parameter;
  }, rustOwnedStorageChild);
  const transformed = parameters.size !== 0 || lifetimeCount !== 0;
  return Object.freeze({ carrier: transformed ? selected : carrier,
    nestedCarriers: Object.freeze(transformed ? nestedCarriers : []) });
}
