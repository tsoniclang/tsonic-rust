import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustBigIntCarrier, isRustNumericCarrier } from "../../target-model/types/index.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";

export function selectRustArrayElementStorage(
  inferred: TargetTypeRef,
  demands: readonly TargetTypeRef[],
  definitions: RustTypeDefinitions,
): TargetTypeRef {
  const selected = demands[0];
  if (selected === undefined || isRustNumericCarrier(inferred) || isRustBigIntCarrier(inferred) ||
    demands.some(demand => !rustTargetTypeRefEquals(demand, selected)) ||
    rustTargetTypeRefEquals(inferred, selected)) return inferred;
  const conversion = selectRustSourceValueConversion(inferred, selected, definitions);
  const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, definitions);
  return contract !== undefined && !contract.fallible &&
    (contract.category === "exact" || contract.category === "projection") &&
    rustTargetTypeRefEquals(contract.source, inferred) && rustTargetTypeRefEquals(contract.target, selected)
    ? selected : inferred;
}
