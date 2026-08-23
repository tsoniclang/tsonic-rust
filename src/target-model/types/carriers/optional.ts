import { rustOptionTargetId } from "./source-types.js";
import type { TargetTypeRef } from "../model.js";

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustOptionTargetId, typeArguments: [value] };
}

export function isRustOptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId;
}

export function rustOptionElementCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}
