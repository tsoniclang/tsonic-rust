import type { TargetTypeRef } from "../types/model.js";
import { rustOptionElementCarrier } from "../types/carriers/optional.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../types/equality.js";

export interface RustProviderRecordAbsentField {
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
}

export function rustProviderRecordAbsentFieldsMatch(fields: readonly RustProviderRecordAbsentField[]): boolean {
  return isClosedMetadata(fields) && isDenseDataArray(fields) && fields.every(field =>
    hasExactObjectKeys(field, ["targetName", "carrier"]) && typeof field.targetName === "string" && field.targetName.length !== 0 &&
    isRustTargetTypeRef(field.carrier) && rustOptionElementCarrier(field.carrier) !== undefined) &&
    new Set(fields.map(field => field.targetName)).size === fields.length;
}
