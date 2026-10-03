import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { isRustValueConversion } from "../../../target-model/conversions/shape.js";
import type { RustFinalizedValueConversion } from "./model.js";
import { hasExactKeys, isRecord } from "./validation-records.js";

export function isFinalizedConversion(value: unknown): value is RustFinalizedValueConversion {
  if (!isClosedMetadata(value) || !isRecord(value) ||
    !isRustTargetTypeRef(value.sourceCarrier) || !isRustTargetTypeRef(value.targetCarrier)) return false;
  if (value.kind === "identity") return hasExactKeys(value,
    ["kind", "sourceCarrier", "targetCarrier", "fallible"]) && value.fallible === false;
  return value.kind === "semantic" && hasExactKeys(value,
    ["kind", "conversion", "sourceCarrier", "targetCarrier", "fallible"]) &&
    typeof value.fallible === "boolean" && isRustValueConversion(value.conversion);
}
