import {
  isRustAbsenceCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";

export function selectedOptionNullishRelationship(
  leftCarrier: TargetTypeRef | undefined,
  rightCarrier: TargetTypeRef | undefined,
): { readonly depths: readonly number[]; readonly negated: boolean } | undefined {
  const selected = (depths: readonly number[], negated = false) =>
    Object.freeze({ depths: Object.freeze(depths), negated });
  if (!isRustTargetTypeRef(leftCarrier) || !isRustTargetTypeRef(rightCarrier)) return undefined;
  const carrier = isRustAbsenceCarrier(rightCarrier) ? leftCarrier
    : isRustAbsenceCarrier(leftCarrier) ? rightCarrier : undefined;
  if (carrier === undefined) return undefined;
  if (rustOptionalStorageValue(carrier) !== undefined) return selected([0]);
  if (!isRustOptionCarrier(carrier)) return undefined;
  const payload = rustOptionElementCarrier(carrier);
  if (payload === undefined) return undefined;
  if (isRustAbsenceCarrier(payload)) return selected([], true);
  return selected(carrier.kind === "target-named" && carrier.sourceAbsence !== true &&
    payload.kind === "target-named" && payload.sourceAbsence === true ? [0, 1] : [0]);
}
