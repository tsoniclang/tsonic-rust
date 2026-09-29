import type { TargetTypeRef } from "../types/model.js";
import { rustCallableProtocol, rustOptionElementCarrier, rustUnitTargetType } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export interface RustCallableAbsenceCompletion {
  readonly kind: "callable-absence-completion";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

export function rustCallableAbsenceCompletionMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  const sourceCallable = rustCallableProtocol(source);
  const targetCallable = rustCallableProtocol(target);
  return sourceCallable !== undefined && targetCallable !== undefined &&
    rustTargetTypeRefEquals(sourceCallable.result, rustUnitTargetType()) &&
    rustOptionElementCarrier(targetCallable.result) !== undefined &&
    sourceCallable.parameters.length <= targetCallable.parameters.length &&
    sourceCallable.parameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter, targetCallable.parameters[index]));
}
