import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceGenericContract } from "../../../target-model/lifetimes/index.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { selectRustCallableStorageLifetime } from "../../ownership/suspended-storage.js";
import type { RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustOwnedStorageChild } from "./owned-storage.js";

export function closeRustSuspendedStorage(
  result: TargetTypeRef, parameters: readonly (TargetTypeRef | undefined)[], contract: RustSourceGenericContract | undefined,
  placement: "callable-result" | "callable-signature" | "field",
  retainedLifetime?: RustLifetimeRef,
): TargetTypeRef | undefined {
  let unresolved = false;
  const selected = mapRustTargetTypes(result, carrier => {
    const callable = rustCallableProtocol(carrier);
    if (placement === "callable-result" && callable?.lifetime?.kind === "placeholder") {
      const lifetime = retainedLifetime ?? (parameters.some(parameter => parameter === undefined) ? undefined
        : selectRustCallableStorageLifetime(parameters as readonly TargetTypeRef[], parameters as readonly TargetTypeRef[], contract));
      if (lifetime === undefined) { unresolved = true; return carrier; }
      return rustCallableTargetType(callable.parameters, callable.result, lifetime, callable.error);
    }
    return carrier;
  }, rustOwnedStorageChild);
  return unresolved ? undefined : selected;
}
