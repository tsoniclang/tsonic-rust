import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";

import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";

import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

export function rustReferentMutationRequiresMutableBinding(
  path: readonly (readonly TargetTypeRef[])[],
  isSharedObject: (carrier: TargetTypeRef) => boolean,
): boolean {
  return path.every(receivers => receivers.some(carrier => nativeReceiverRequiresMutableBinding(carrier, isSharedObject)));
}

function nativeReceiverRequiresMutableBinding(
  carrier: TargetTypeRef,
  isSharedObject: (carrier: TargetTypeRef) => boolean,
): boolean {
  const element = rustOptionElementCarrier(carrier);
  if (element !== undefined) return nativeReceiverRequiresMutableBinding(element, isSharedObject);
  if (isRustClosedValueCarrier(carrier)) return false;
  if (isRustMutableJsErrorCarrier(carrier) || isRustSourceErrorCarrier(carrier) || isRustRetainedErrorCarrier(carrier)) return false;
  if (isSharedObject(carrier)) return false;
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural === undefined || structural.representation === "value";
}
