import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";

import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";

import { rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

export function rustCarrierReferentMutationRequiresMutableBinding(
  carrier: TargetTypeRef | undefined,
  isSharedObject: (carrier: TargetTypeRef) => boolean = () => false,
): boolean {
  const element = rustOptionElementCarrier(carrier);
  if (element !== undefined) return rustCarrierReferentMutationRequiresMutableBinding(element, isSharedObject);
  if (isRustClosedValueCarrier(carrier)) return false;
  if (isRustMutableJsErrorCarrier(carrier) || isRustSourceErrorCarrier(carrier) || isRustRetainedErrorCarrier(carrier)) return false;
  if (carrier !== undefined && isSharedObject(carrier)) return false;
  const structural = rustStructuralObjectCarrierValue(carrier);
  return (structural === undefined || structural.representation === "value") &&
    rustSourceUnionCarrierValue(carrier) === undefined;
}
