import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustBorrowedStrTargetType, isRustStringViewCarrier } from "../../../target-model/types/carriers/native.js";
import { isRustOptionCarrier, rustOptionElementCarrier, rustOptionTargetType } from "../../../target-model/types/carriers/optional.js";
import { isRustCopyCarrier } from "../../constraints/native-traits.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import type { RustOptionEqualityContract, RustOptionEqualityView } from "../../../target-model/operations/option-equality.js";
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
  const stringView = isRustStringViewCarrier(leftPayload.carrier) && isRustStringViewCarrier(rightPayload.carrier);
  if (!stringView && !rustTargetTypeRefEquals(leftPayload.carrier, rightPayload.carrier)) return undefined;
  const view: RustOptionEqualityView = stringView ? "str" : isRustCopyCarrier(leftPayload.carrier) ? "value" : "shared";
  let comparisonCarrier: TargetTypeRef = view === "str" ? rustBorrowedStrTargetType()
    : view === "shared" ? { kind: "reference", referent: leftPayload.carrier, mutable: false } : leftPayload.carrier;
  for (let index = 0; index < depth; index += 1) comparisonCarrier = rustOptionTargetType(comparisonCarrier);
  return Object.freeze({
    leftCarrier: left,
    rightCarrier: right,
    comparisonCarrier,
    leftLiftDepth: depth - leftPayload.depth,
    rightLiftDepth: depth - rightPayload.depth,
    view,
  });
}
