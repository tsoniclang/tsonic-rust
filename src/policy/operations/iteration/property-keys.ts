import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import { rustFixedArrayCarrierValue, isRustJsArrayLikeCarrier, isRustStringCarrier } from "../../../target-model/types/index.js";
import { rustRecordCarrierValue } from "../../../target-model/types/carriers/records.js";

export function selectRustPropertyKeyIterationLowering(iterable: TargetTypeRef | undefined): Extract<RustTargetOperationFact, { readonly kind: "iteration"; readonly iterationKind: "for-in" }>["lowering"] | undefined {
  if (iterable?.kind === "array" ||
    (iterable?.kind === "reference" && iterable.referent.kind === "slice") ||
    rustFixedArrayCarrierValue(iterable) !== undefined) {
    return { kind: "dense-index-keys" };
  }
  if (isRustJsArrayLikeCarrier(iterable)) {
    return { kind: "js-array-index-keys" };
  }
  if (isRustStringCarrier(rustRecordCarrierValue(iterable)?.key)) return { kind: "record-keys" };
  return undefined;
}
