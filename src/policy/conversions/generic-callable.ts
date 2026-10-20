import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";
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
