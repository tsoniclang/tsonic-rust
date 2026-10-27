import { type TargetTypeRef } from "../../../target-model/types/model.js";
import { type RustBindingProjectionFact } from "../../../target-model/records/objects/value-projections.js";
import { rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";
import { type RustBindingNormalization } from "../../../target-model/types/binding-normalization.js";

export function rustBindingProjectionCloneCarriers(fact: RustBindingProjectionFact): readonly TargetTypeRef[] {
  if (!("projectedCarrier" in fact)) return [];
  switch (fact.projection.kind) {
    case "js-array-element":
    case "js-array-rest": {
      const element = rustJsArrayLikeElementTargetType(fact.sourceCarrier);
      return element === undefined ? [] : [element];
    }
    case "object-rest": return fact.projection.fields.map(field => field.carrier);
    default: return [fact.projectedCarrier];
  }
}








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
