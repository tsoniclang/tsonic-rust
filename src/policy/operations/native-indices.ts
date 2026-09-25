import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import { isRustIntegerCarrier, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustExactIntegerConversion } from "../../target-model/conversions/exact-integer.js";

export interface RustNativeIndexSelection {
  readonly carrier: TargetTypeRef;
  readonly conversion?: RustValueConversion;
}

export function selectRustNativeIndex(carrier: TargetTypeRef | undefined): RustNativeIndexSelection | undefined {
  if (carrier === undefined || !isRustIntegerCarrier(carrier)) return undefined;
  const target = rustSourcePrimitiveTargetType("native-uint");
  if (rustTargetTypeRefEquals(carrier, target)) return { carrier };
  const conversion = selectRustExactIntegerConversion(carrier, target);
  return conversion === undefined ? undefined : { carrier, conversion };
}
