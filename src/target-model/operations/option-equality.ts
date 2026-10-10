import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../types/equality.js";
import { rustBorrowedStrTargetType, isRustStringViewCarrier } from "../types/carriers/native.js";
import { isRustOptionCarrier, rustOptionElementCarrier, rustOptionTargetType } from "../types/carriers/optional.js";
import type { TargetTypeRef } from "../types/model.js";

export interface RustOptionEqualityContract {
  readonly leftCarrier: TargetTypeRef;
  readonly rightCarrier: TargetTypeRef;
  readonly comparisonCarrier: TargetTypeRef;
  readonly leftLiftDepth: number;
  readonly rightLiftDepth: number;
  readonly borrowString: boolean;
}

function optionPayload(carrier: TargetTypeRef): { readonly depth: number; readonly carrier: TargetTypeRef } | undefined {
  let current = carrier;
  let depth = 0;
  for (;;) {
    const element = rustOptionElementCarrier(current);
    if (element === undefined) return isRustOptionCarrier(current) ? undefined : { depth, carrier: current };
    current = element;
    depth += 1;
  }
}

export function rustOptionEqualityContract(
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
): RustOptionEqualityContract | undefined {
  if (!isRustOptionCarrier(left) && !isRustOptionCarrier(right) || !isRustTargetTypeRef(left) || !isRustTargetTypeRef(right)) return undefined;
  const leftPayload = optionPayload(left);
  const rightPayload = optionPayload(right);
  if (leftPayload === undefined || rightPayload === undefined) return undefined;
  const depth = Math.max(leftPayload.depth, rightPayload.depth);
  if (depth === 0) return undefined;
  const borrowString = isRustStringViewCarrier(leftPayload.carrier) && isRustStringViewCarrier(rightPayload.carrier);
  if (!borrowString && !rustTargetTypeRefEquals(leftPayload.carrier, rightPayload.carrier)) return undefined;
  let comparisonCarrier = borrowString ? rustBorrowedStrTargetType() : leftPayload.carrier;
  for (let index = 0; index < depth; index += 1) comparisonCarrier = rustOptionTargetType(comparisonCarrier);
  return Object.freeze({
    leftCarrier: left,
    rightCarrier: right,
    comparisonCarrier,
    leftLiftDepth: depth - leftPayload.depth,
    rightLiftDepth: depth - rightPayload.depth,
    borrowString,
  });
}
