import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import type { RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustOwnedStorageChild, rustOwnedStorageChildren } from "./owned-storage.js";

export function closeRustSuspendedStorage(
  result: TargetTypeRef,
  placement: "callable-result" | "callable-signature" | "field",
  retainedLifetime?: RustLifetimeRef,
): TargetTypeRef | undefined {
  if (placement !== "callable-result" || !hasOpenStorage(result)) return result;
  let unresolved = false;
  const selected = mapRustTargetTypes(result, carrier => {
    const callable = rustCallableProtocol(carrier);
    if (callable?.lifetime?.kind === "placeholder") {
      const lifetime = retainedLifetime;
      if (lifetime === undefined) { unresolved = true; return carrier; }
      return rustCallableTargetType(callable.parameters, callable.result, lifetime, callable.error);
    }
    return carrier;
  }, rustOwnedStorageChild);
  return unresolved ? undefined : selected;
}

function hasOpenStorage(carrier: TargetTypeRef): boolean {
  return rustCallableProtocol(carrier)?.lifetime?.kind === "placeholder" || rustOwnedStorageChildren(carrier).some(hasOpenStorage);
}
