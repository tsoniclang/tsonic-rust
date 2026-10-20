import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustEmptyObjectTargetType, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustEmptyRecordConversion } from "../../target-model/conversions/empty-record.js";
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
