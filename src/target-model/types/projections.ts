import { createHash } from "node:crypto";
import type { TargetTypeRef } from "./model.js";
import { closedMetadataKey } from "../metadata/closed-data.js";
import { isRustAbsenceCarrier, rustAbsenceTargetType } from "./carriers/native.js";
import { rustOptionTargetType } from "./carriers/optional.js";
import { rustJsValueTargetId, rustTsValueTargetId } from "./carriers/source-types.js";
import { rustOptionNestingDepth } from "./carriers/optional.js";
import { rustTargetTypeRefEquals } from "./equality.js";

export type RustOptionalStorageProjection = Extract<TargetTypeRef, { readonly kind: "type-parameter" }> & {
  readonly optionalStorageValue: TargetTypeRef;
};

export function rustOptionalStorageProjection(value: TargetTypeRef): RustOptionalStorageProjection {
  const identity = createHash("sha256").update(closedMetadataKey(value)).digest("hex").slice(0, 16);
  return Object.freeze({ kind: "type-parameter", identity: `optional-storage:${identity}`, name: `OptionalStorage${identity}`, optionalStorageValue: value });
}

export function rustSourceOptionalTargetType(value: TargetTypeRef): TargetTypeRef {
  if (isRustAbsenceCarrier(value)) return rustAbsenceTargetType();
  if (value.kind === "target-named" && (value.sourceAbsence === true ||
    value.id === rustJsValueTargetId || value.id === rustTsValueTargetId)) return value;
  if (value.kind === "type-parameter" && value.optionalStorageValue !== undefined) return value;
  if (value.kind === "type-parameter" || value.kind === "associated-type") return rustOptionalStorageProjection(value);
  return { ...rustOptionTargetType(value) as Extract<TargetTypeRef, { readonly kind: "target-named" }>, sourceAbsence: true };
}

export function rustOptionalStorageValue(type: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return type?.kind === "type-parameter" ? type.optionalStorageValue
    : type?.kind === "target-named" && (type.id === rustJsValueTargetId || type.id === rustTsValueTargetId) ? type : undefined;
}

export function rustOptionalStorageNestingDepth(storage: TargetTypeRef | undefined, value: TargetTypeRef | undefined): number | undefined {
  return value !== undefined && rustTargetTypeRefEquals(rustOptionalStorageValue(storage), value)
    ? 1 : rustOptionNestingDepth(storage, value);
}
