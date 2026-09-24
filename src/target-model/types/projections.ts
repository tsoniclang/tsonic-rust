import { createHash } from "node:crypto";
import type { TargetTypeRef } from "./model.js";
import { closedMetadataKey } from "../metadata/closed-data.js";
import { rustAbsenceTargetType } from "./carriers/native.js";
import { isRustAbsenceCarrier } from "./carriers/js.js";
import { rustOptionTargetType } from "./carriers/optional.js";
import { rustJsValueTargetId } from "./carriers/source-types.js";

export type RustOptionalStorageProjection = Extract<TargetTypeRef, { readonly kind: "type-parameter" }> & {
  readonly optionalStorageValue: TargetTypeRef;
};

export function rustOptionalStorageProjection(value: TargetTypeRef): RustOptionalStorageProjection {
  const identity = createHash("sha256").update(closedMetadataKey(value)).digest("hex").slice(0, 16);
  return Object.freeze({ kind: "type-parameter", name: `OptionalStorage${identity}`, optionalStorageValue: value });
}

export function rustSourceOptionalTargetType(value: TargetTypeRef): TargetTypeRef {
  if (isRustAbsenceCarrier(value)) return rustAbsenceTargetType();
  if (value.kind === "target-named" && (value.sourceAbsence === true ||
    value.id === rustJsValueTargetId)) return value;
  if (value.kind === "type-parameter" && value.optionalStorageValue !== undefined) return value;
  if (value.kind === "type-parameter" || value.kind === "associated-type") return rustOptionalStorageProjection(value);
  return { ...rustOptionTargetType(value) as Extract<TargetTypeRef, { readonly kind: "target-named" }>, sourceAbsence: true };
}

export function rustOptionalStorageValue(type: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return type?.kind === "type-parameter" ? type.optionalStorageValue : undefined;
}
