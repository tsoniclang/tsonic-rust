import type { AstReader, Node } from "@tsonic/tsts";
import { isRustAbsenceCarrier, isRustIntegerCarrier, isRustNumericCarrier, rustOptionElementCarrier, rustOptionTargetType,
  rustSourceOptionalTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustNumericPromotionKind } from "../../target-model/conversions/numeric-promotion.js";
import { selectedSourceLiteralIsRepresentable } from "./selected-numeric-literal.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function selectRustConditionalNumericCarrier(
  whenTrue: Node,
  whenFalse: Node,
  trueCarrier: TargetTypeRef | undefined,
  falseCarrier: TargetTypeRef | undefined,
  ast: AstReader,
): TargetTypeRef | undefined {
  const trueElement = rustOptionElementCarrier(trueCarrier);
  const falseElement = rustOptionElementCarrier(falseCarrier);
  const left = trueElement ?? trueCarrier;
  const right = falseElement ?? falseCarrier;
  const optional = trueElement !== undefined || falseElement !== undefined ||
    isRustAbsenceCarrier(left) || isRustAbsenceCarrier(right);
  let selected: TargetTypeRef | undefined;
  if (isRustAbsenceCarrier(left) && isRustIntegerCarrier(right)) selected = right;
  else if (isRustAbsenceCarrier(right) && isRustIntegerCarrier(left)) selected = left;
  else if (isRustIntegerCarrier(left) && isRustIntegerCarrier(right)) {
    const promoted = rustNumericPromotionKind(left.name, right.name);
    selected = promoted === undefined ? undefined : rustSourcePrimitiveTargetType(promoted);
  } else if (isRustIntegerCarrier(left) && selectedSourceLiteralIsRepresentable(whenFalse, left.name, ast)) {
    selected = left;
  } else if (isRustIntegerCarrier(right) && selectedSourceLiteralIsRepresentable(whenTrue, right.name, ast)) {
    selected = right;
  } else if (isRustNumericCarrier(left) && isRustNumericCarrier(right)) {
    const promoted = rustNumericPromotionKind(left.name, right.name);
    selected = promoted === undefined ? undefined : rustSourcePrimitiveTargetType(promoted);
  }
  const sourceAbsence = isRustAbsenceCarrier(left) || isRustAbsenceCarrier(right) ||
    rustSourceOptionalElementCarrier(trueCarrier) !== undefined || rustSourceOptionalElementCarrier(falseCarrier) !== undefined;
  return selected === undefined ? undefined : !optional ? selected
    : sourceAbsence ? rustSourceOptionalTargetType(selected) : rustOptionTargetType(selected);
}
