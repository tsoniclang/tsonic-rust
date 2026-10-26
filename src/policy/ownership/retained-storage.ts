import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCallableProtocol, rustCallableTargetType, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustOwnedStorageChild, rustOwnedStorageChildren } from "../../policy/types/storage/owned-storage.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";

export const rustRequiresCallableFieldStorage = (carrier: TargetTypeRef): boolean => carrier.kind !== "function-pointer" && carrier.kind !== "closure" &&
  (rustCallableProtocol(carrier) !== undefined || rustGenericCallableValue(carrier) !== undefined ||
    rustOwnedStorageChildren(carrier).some(rustRequiresCallableFieldStorage));

import { rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustClassEnvironment } from "../../target-model/records/class-values.js";
import { isRustCopyCarrier } from "../constraints/native-traits.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function selectRustStructuralFactoryReceiver(input: {
  readonly factory: boolean;
  readonly usesThis: boolean;
  readonly capturedValues: number;
}): "value" | "shared" {
  return input.factory && (input.usesThis || input.capturedValues !== 0) ? "value" : "shared";
}

export function selectRustNativeFutureEnvironmentRetention(input: {
  readonly lifetime: RustLifetimeRef;
  readonly carriers: readonly TargetTypeRef[];
  readonly taskScope: boolean;
}): boolean {
  if (input.taskScope) return true;
  const references = rustTargetGenericReferences({ kind: "tuple", elements: input.carriers });
  return references.hasUnnameableLifetime || references.lifetimeIdentities.includes(rustLifetimeKey(input.lifetime));
}

export function selectRustClassEnvironmentStorage(
  input: Pick<RustClassEnvironment, "constructorIdentity" | "staticFields" | "captures">,
): Pick<RustClassEnvironment, "storage" | "copy"> {
  const copy = !input.constructorIdentity && input.staticFields.length === 0 &&
    input.captures.every(capture => capture.storage === "value" && isRustCopyCarrier(capture.carrier));
  const storage = !input.constructorIdentity && (copy || input.staticFields.length === 0 &&
    input.captures.length === 1 && input.captures[0]!.storage === "location") ? "value" : "shared";
  return Object.freeze({ storage, copy });
}

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
    if (original.kind === "reference" || original.kind === "pointer" ||
      original.kind === "function-pointer" || original.kind === "closure") return original;
    const protocol = rustCallableProtocol(original);
    if (protocol !== undefined) return protocol.lifetime?.kind === "placeholder"
      ? rustCallableTargetType(protocol.parameters, protocol.result, lifetime, protocol.error) : original;
    const named = rustNamedTypeCarrierValue(original);
    if (named?.id === rustCallableTargetId) {
      const environment = named.genericArguments[0];
      return environment?.kind === "lifetime" && environment.lifetime.kind === "placeholder"
        ? { ...original, value: { ...named, genericArguments: Object.freeze([
          { kind: "lifetime", lifetime }, ...named.genericArguments.slice(1),
        ]) } } : original;
    }
    if (original.kind === "type-parameter" && original.optionalStorageValue !== undefined) {
      const payload = closeRustRetainedCallableCarrier(original.optionalStorageValue, lifetime);
      return payload === original.optionalStorageValue ? original : { ...original, optionalStorageValue: payload };
    }
    return rustTargetTypeRefEquals(current, original) ? original : current;
  }, (parent, child, role) => parent.kind !== "reference" && parent.kind !== "pointer" &&
    parent.kind !== "function-pointer" && parent.kind !== "closure" && parent.kind !== "type-parameter" &&
    rustCallableProtocol(parent) === undefined && rustNamedTypeCarrierValue(parent)?.id !== rustCallableTargetId &&
    rustOwnedStorageChild(parent, child, role));
}
