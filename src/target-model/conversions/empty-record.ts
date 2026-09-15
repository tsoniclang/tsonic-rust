import type { TargetTypeRef } from "../types/model.js";
import { rustEmptyObjectTargetType, rustStructuralObjectCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export interface RustEmptyRecordConversion {
  readonly kind: "empty-record";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

export function rustEmptyRecordCarrier(type: TargetTypeRef): boolean {
  if (rustTargetTypeRefEquals(type, rustEmptyObjectTargetType())) return true;
  const structural = rustStructuralObjectCarrierValue(type);
  return structural?.representation === "value" && structural.fields.length === 0;
}

export function rustEmptyRecordConversionMatches(
  conversion: RustEmptyRecordConversion,
  source: TargetTypeRef,
  target: TargetTypeRef,
): boolean {
  return rustTargetTypeRefEquals(source, conversion.source) &&
    rustTargetTypeRefEquals(target, conversion.target) &&
    rustEmptyRecordCarrier(source) && rustEmptyRecordCarrier(target) &&
    !rustTargetTypeRefEquals(source, target);
}
