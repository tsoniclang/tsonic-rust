import type { TargetTypeRef } from "../model.js";
import { rustTypeGenericArguments } from "../generic-arguments.js";
import { rustJsPromiseFulfilledResultTargetId, rustJsPromiseRejectedResultTargetId, rustJsPromiseResolutionTargetId, rustJsPromiseSettledResultTargetId, rustJsPromiseTargetId } from "./source-types.js";

export function rustJsPromiseTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseTargetId, genericArguments: rustTypeGenericArguments([output]) };
}

export function rustJsPromiseOutputTargetType(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsPromiseTargetId) return undefined;
  const [output] = carrier.genericArguments ?? [];
  return carrier.genericArguments?.length === 1 && output?.kind === "type" ? output.type : undefined;
}

export function rustJsPromiseResolutionTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseResolutionTargetId, genericArguments: rustTypeGenericArguments([output]) };
}

export function rustJsPromiseFulfilledResultTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseFulfilledResultTargetId, genericArguments: rustTypeGenericArguments([value]) };
}

export function rustJsPromiseRejectedResultTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseRejectedResultTargetId };
}

export function rustJsPromiseSettledResultTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseSettledResultTargetId, genericArguments: rustTypeGenericArguments([value]) };
}
