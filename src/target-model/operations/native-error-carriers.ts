import { isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../types/equality.js";
import { isRustProgramErrorCarrier, rustNamedTypeCarrierValue, rustTargetGenericReferences } from "../types/index.js";
import type { TargetTypeRef } from "../types/model.js";

export function isRustNativeErrorCarriers(value: unknown): value is readonly TargetTypeRef[] {
  if (!isClosedMetadata(value) || !isDenseDataArray(value) || value.length === 0) return false;
  const selected: TargetTypeRef[] = [];
  for (const carrier of value) {
    if (!isRustTargetTypeRef(carrier) || isRustProgramErrorCarrier(carrier) ||
      carrier.kind !== "target-named" && rustNamedTypeCarrierValue(carrier) === undefined ||
      selected.some(existing => rustTargetTypeRefEquals(existing, carrier))) return false;
    const references = rustTargetGenericReferences(carrier);
    if (references.typeIdentities.length !== 0 || references.lifetimeIdentities.length !== 0 ||
      references.constIdentities.length !== 0 || references.hasUnnameableLifetime) return false;
    selected.push(carrier);
  }
  return true;
}
