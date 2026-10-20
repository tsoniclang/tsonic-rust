import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { isRustBigIntCarrier, rustJsNumericTargetType, rustJsStringNumberTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../target-model/types/index.js";

import { rustGenericCallableSignaturesMatch } from "../conversions/generic-callable.js";

export function selectRustImmediateUnionCarrier(values: readonly TargetTypeRef[], jsEnabled: boolean): TargetTypeRef | undefined {
  const callable = values[0];
  if (callable !== undefined && values.every(value => rustGenericCallableSignaturesMatch(value, callable))) return callable;
  if (jsEnabled && values.length === 2 &&
    values.some(carrier => rustTargetTypeRefEquals(carrier, rustSourcePrimitiveTargetType("float64")))) {
    if (values.some(carrier => rustTargetTypeRefEquals(carrier, rustStringTargetType()))) {
      return rustJsStringNumberTargetType();
    }
    if (values.some(isRustBigIntCarrier)) return rustJsNumericTargetType();
  }
  return undefined;
}
