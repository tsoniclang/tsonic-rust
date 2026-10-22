import { rustOptionTargetType } from "../../../target-model/types/carriers/optional.js";
import { rustUnitTargetType } from "../../../target-model/types/carriers/native.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustStaticLifetime } from "../../../target-model/lifetimes/index.js";

import { rustGenericCallableProtocol, rustGenericCallableTargetType, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";

import { rustStructuralMethodCallableCarrier, rustStructuralPropertyValueCarrier, rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
export function rustStructuralMethodStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const callableCarrier = rustStructuralMethodCallableCarrier(fieldCarrier, presence);
  const generic = rustGenericCallableValue(callableCarrier);
  if (generic !== undefined) {
    const protocol = rustGenericCallableProtocol(callableCarrier);
    const storage = protocol === undefined ? undefined : rustGenericCallableTargetType(
      generic.signature.typeParameters, [receiverCarrier, ...protocol.parameters], protocol.result, generic.origin, generic.environment,
    );
    return storage === undefined ? undefined : presence === "optional" ? rustOptionTargetType(storage) : storage;
  }
  const callable = rustCallableProtocol(callableCarrier);
  if (callable === undefined) {
    return undefined;
  }
  const storageCarrier = rustCallableTargetType(
    [receiverCarrier, ...callable.parameters],
    callable.result,
    callable.lifetime,
    callable.error,
  );
  return presence === "optional" ? rustOptionTargetType(storageCarrier) : storageCarrier;
}

// An accessor slot has no authored callable type to name a lifetime, and an accessor is created as an owned 'static
// callable where its literal is evaluated, so the slot stores a 'static callable (a struct field cannot elide it).
export function rustStructuralPropertyGetterStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(fieldCarrier, presence);
  return valueCarrier === undefined
    ? undefined
    : rustOptionTargetType(rustCallableTargetType([receiverCarrier], valueCarrier, rustStaticLifetime));
}

export function rustStructuralPropertySetterStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(fieldCarrier, presence);
  return valueCarrier === undefined
    ? undefined
    : rustOptionTargetType(rustCallableTargetType(
        [receiverCarrier, valueCarrier],
        rustUnitTargetType(),
        rustStaticLifetime,
      ));
}
