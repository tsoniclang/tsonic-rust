import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustJsMapTargetId, rustJsSetTargetId } from "../../../../target-model/types/carriers/source-types.js";

export interface RustJsStoredTypeArgumentSlot {
  readonly index: number;
  readonly nativeArgumentIndex: number;
  readonly carrier: TargetTypeRef;
}

const nativeArgumentIndices: ReadonlyMap<string, readonly number[]> = new Map([
  [rustJsMapTargetId, [0, 1]],
  [rustJsSetTargetId, [0]],
]);

export function selectRustJsStoredTypeArgumentSlots(
  carrier: TargetTypeRef | undefined,
): readonly RustJsStoredTypeArgumentSlot[] | undefined {
  if (carrier?.kind !== "target-named") return undefined;
  const indices = nativeArgumentIndices.get(carrier.id);
  const arguments_ = carrier.genericArguments;
  if (indices === undefined || arguments_ === undefined || arguments_.length !== indices.length) return undefined;
  const slots: RustJsStoredTypeArgumentSlot[] = [];
  for (const [index, nativeArgumentIndex] of indices.entries()) {
    const argument = arguments_[nativeArgumentIndex];
    if (argument?.kind !== "type") return undefined;
    slots.push(Object.freeze({ index, nativeArgumentIndex, carrier: argument.type }));
  }
  return Object.freeze(slots);
}
