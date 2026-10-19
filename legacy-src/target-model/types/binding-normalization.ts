import type { TargetTypeRef } from "./model.js";
import { rustTargetTypeRefEquals } from "./equality.js";
import { rustOptionElementCarrier } from "./carriers/optional.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "./projections.js";
import { isRustAbsenceCarrier } from "./carriers/native.js";

export type RustBindingNormalization =
  | "identity"
  | "default-on-none"
  | "default-on-absence"
  | "checked-array"
  | "checked-array-default";

export function rustBindingNormalizationContract(
  projectedCarrier: TargetTypeRef,
  defaultCarrier: TargetTypeRef | undefined,
  checkedArrayElement?: TargetTypeRef,
): { readonly storageCarrier: TargetTypeRef; readonly bindingCarrier: TargetTypeRef; readonly normalization: RustBindingNormalization } | undefined {
  if (checkedArrayElement !== undefined &&
    !rustTargetTypeRefEquals(rustOptionElementCarrier(projectedCarrier), checkedArrayElement)) return undefined;
  if (isRustAbsenceCarrier(projectedCarrier) && defaultCarrier !== undefined) return {
    storageCarrier: projectedCarrier, bindingCarrier: defaultCarrier, normalization: "default-on-absence",
  };
  const storageCarrier = checkedArrayElement === undefined ? projectedCarrier : rustSourceOptionalTargetType(checkedArrayElement);
  const value = rustOptionElementCarrier(storageCarrier) ?? rustOptionalStorageValue(storageCarrier);
  const defaulted = defaultCarrier !== undefined && value !== undefined;
  const retainsAbsence = defaultCarrier !== undefined && (isRustAbsenceCarrier(defaultCarrier) ||
    defaultCarrier.kind === "target-named" && defaultCarrier.sourceAbsence === true ||
    defaultCarrier.kind === "type-parameter" && defaultCarrier.optionalStorageValue !== undefined);
  return { storageCarrier, bindingCarrier: defaulted && !retainsAbsence ? value : storageCarrier,
    normalization: checkedArrayElement !== undefined ? defaulted ? "checked-array-default" : "checked-array"
      : defaulted ? "default-on-none" : "identity" };
}
