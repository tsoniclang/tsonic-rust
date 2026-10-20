import { rustCallableProtocol } from "../../../target-model/types/index.js";

import { rustGenericCallableProtocol } from "../../../target-model/types/carriers/generic-callables.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function runtimeCallableProtocol(
  carrier: TargetTypeRef | undefined,
): {
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
} | undefined {
  if (carrier?.kind === "function-pointer" || carrier?.kind === "closure") {
    return { parameters: carrier.args, result: carrier.result };
  }
  return rustGenericCallableProtocol(carrier) ?? rustCallableProtocol(carrier);
}
