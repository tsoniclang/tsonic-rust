import { rustOptionTargetId } from "./source-types.js";
import type { TargetTypeRef } from "../model.js";
import { rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../generic-arguments.js";
import { rustTargetTypeRefEquals } from "../equality.js";

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustOptionTargetId,
    genericArguments: rustTypeGenericArguments([value]),
  };
}

export function isRustOptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "type-parameter" && carrier.optionalStorageValue !== undefined ||
    carrier?.kind === "target-named" && carrier.id === rustOptionTargetId;
}

export function rustOptionElementCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind === "type-parameter") return carrier.optionalStorageValue;
  if (carrier?.kind !== "target-named" || carrier.id !== rustOptionTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  return arguments_?.length === 1 ? arguments_[0] : undefined;
}

export function rustOptionNestingDepth(
  option: TargetTypeRef | undefined,
  value: TargetTypeRef | undefined,
): number | undefined {
  if (option === undefined || value === undefined) return undefined;
  const visited = new Set<TargetTypeRef>();
  let current: TargetTypeRef | undefined = option;
  for (let depth = 0; current !== undefined && !visited.has(current); depth += 1) {
    if (rustTargetTypeRefEquals(current, value)) return depth;
    visited.add(current);
    current = rustOptionElementCarrier(current);
  }
  return undefined;
}

export function rustOptionValueCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  const visited = new Set<TargetTypeRef>();
  while (carrier !== undefined) {
    if (visited.has(carrier)) return undefined;
    visited.add(carrier);
    const element = rustOptionElementCarrier(carrier);
    if (element === undefined) return carrier;
    carrier = element;
  }
  return undefined;
}
