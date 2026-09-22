import type { TargetTypeRef } from "../types/model.js";
import { rustGenericCallableValue } from "../types/carriers/generic-callables.js";
import { closedMetadataEquals } from "../metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export interface RustGenericCallableConversion {
  readonly kind: "generic-callable-flow";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

export function rustGenericCallableSignaturesMatch(source: TargetTypeRef, target: TargetTypeRef): boolean {
  const left = rustGenericCallableValue(source);
  const right = rustGenericCallableValue(target);
  return left !== undefined && right !== undefined && closedMetadataEquals(left.signature, right.signature) &&
    left.environment.length === right.environment.length &&
    left.environment.every((argument, index) => rustTargetTypeRefEquals(argument, right.environment[index]));
}

export function rustGenericCallableConversionMatches(
  conversion: RustGenericCallableConversion, source: TargetTypeRef, target: TargetTypeRef,
): boolean {
  return rustTargetTypeRefEquals(conversion.source, source) && rustTargetTypeRefEquals(conversion.target, target) &&
    rustGenericCallableSignaturesMatch(source, target);
}
