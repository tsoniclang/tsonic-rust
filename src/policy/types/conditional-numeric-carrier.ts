import type { AstReader, Node } from "@tsonic/tsts";
import { isRustAbsenceCarrier, isRustIntegerCarrier, rustOptionElementCarrier, rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
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
  }
  return selected === undefined ? undefined : optional ? rustOptionTargetType(selected) : selected;
}
