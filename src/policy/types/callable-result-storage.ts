import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceGenericContract } from "../../target-model/lifetimes/index.js";
import { rustJsPromiseTargetId, rustFutureOutputCarrier, rustJsPromiseTargetTypeWithLifetime } from "../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { selectRustSuspendedStorageLifetime } from "../ownership/suspended-storage.js";

export function closeRustCallableResultStorage(
  result: TargetTypeRef, parameters: readonly (TargetTypeRef | undefined)[], contract: RustSourceGenericContract | undefined,
): TargetTypeRef | undefined {
  let unresolved = false;
  const selected = mapRustTargetTypes(result, carrier => {
    if (carrier.kind !== "target-named" || carrier.id !== rustJsPromiseTargetId ||
      carrier.genericArguments?.[0]?.kind !== "lifetime" || carrier.genericArguments[0].lifetime.kind !== "placeholder") return carrier;
    const output = rustFutureOutputCarrier(carrier);
    const lifetime = output === undefined || parameters.some(parameter => parameter === undefined) ? undefined
      : selectRustSuspendedStorageLifetime([...(parameters as readonly TargetTypeRef[]), output], contract);
    if (output === undefined || lifetime === undefined) {
      unresolved = true;
      return carrier;
    }
    return rustJsPromiseTargetTypeWithLifetime(output, lifetime);
  });
  return unresolved ? undefined : selected;
}
