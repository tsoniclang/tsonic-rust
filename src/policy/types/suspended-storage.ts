import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceGenericContract } from "../../target-model/lifetimes/index.js";
import { rustJsPromiseTargetId, rustFutureOutputCarrier, rustJsPromiseTargetTypeWithLifetime } from "../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { selectRustSuspendedStorageLifetime, selectRustCallableStorageLifetime } from "../ownership/suspended-storage.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
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
      return rustCallableTargetType(callable.parameters, callable.result, lifetime);
    }
    if (carrier.kind !== "target-named" || carrier.id !== rustJsPromiseTargetId ||
      carrier.genericArguments?.[0]?.kind !== "lifetime" || carrier.genericArguments[0].lifetime.kind !== "placeholder") return carrier;
    const output = rustFutureOutputCarrier(carrier);
    const error = carrier.genericArguments[2];
    const lifetime = retainedLifetime ?? (output === undefined || error?.kind !== "type" ? undefined
      : selectRustSuspendedStorageLifetime([output, error.type], contract));
    if (output === undefined || lifetime === undefined || error?.kind !== "type") {
      unresolved = true;
      return carrier;
    }
    return rustJsPromiseTargetTypeWithLifetime(output, lifetime, error.type);
  }, rustOwnedStorageChild);
  return unresolved ? undefined : selected;
}
