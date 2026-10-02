import type { TargetTypeRef } from "../types/model.js";
import { isRustAbsenceCarrier, isRustUnitCarrier, rustCallableProtocol, rustOptionElementCarrier } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustOptionalStorageValue } from "../types/projections.js";

export interface RustCallableAbsenceCompletion {
  readonly kind: "callable-absence-completion";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

export function rustCallableAbsenceCompletionMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = rustCallableProtocol(target);
  return sourceCallable !== undefined && targetCallable !== undefined &&
    (isRustUnitCarrier(sourceCallable.result) || isRustAbsenceCarrier(sourceCallable.result)) &&
    (rustOptionElementCarrier(targetCallable.result) !== undefined ||
      rustOptionalStorageValue(targetCallable.result) !== undefined) &&
    sourceCallable.parameters.length <= targetCallable.parameters.length &&
    sourceCallable.parameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter, targetCallable.parameters[index]));
}
