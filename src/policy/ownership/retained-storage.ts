import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCallableProtocol, rustCallableTargetType, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustOwnedStorageChild, rustOwnedStorageChildren } from "../../policy/types/storage/owned-storage.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";

import { type RustLifetimeRef } from "../../target-model/lifetimes/index.js";

export function rustHasOpenCallableEnvironment(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer" ||
    carrier.kind === "function-pointer" || carrier.kind === "closure") return false;
  const protocol = rustCallableProtocol(carrier);
  if (protocol !== undefined) return protocol.lifetime?.kind === "placeholder";
  if (rustGenericCallableProtocol(carrier) !== undefined || rustNativeCallableProtocol(carrier) !== undefined) return false;
  return rustOwnedStorageChildren(carrier).some(rustHasOpenCallableEnvironment);
}

export function rustHasOpenOwnedStorage(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer") return false;
  if (rustCallableProtocol(carrier) !== undefined || rustGenericCallableProtocol(carrier) !== undefined ||
    rustNativeCallableProtocol(carrier) !== undefined || carrier.kind === "type-parameter") return true;
  return rustOwnedStorageChildren(carrier).some(rustHasOpenOwnedStorage);
}

export function closeRustRetainedCallableCarrier(carrier: TargetTypeRef, lifetime: RustLifetimeRef): TargetTypeRef {
  return mapRustTargetTypes(carrier, (current, original) => {
    if (original.kind === "reference" || original.kind === "function-pointer" || original.kind === "closure") return original;
    const protocol = rustCallableProtocol(original);
    return protocol === undefined ? current : protocol.lifetime?.kind === "placeholder"
      ? rustCallableTargetType(protocol.parameters, protocol.result, lifetime, protocol.error) : original;
  }, rustOwnedStorageChild);
}
