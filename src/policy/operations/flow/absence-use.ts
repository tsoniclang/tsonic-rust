import type { SourceAbsenceUse } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";

export function rustSourceAbsenceReadCarrier(
  source: TargetTypeRef | undefined,
  selected: TargetTypeRef | undefined,
  use: SourceAbsenceUse,
): TargetTypeRef | undefined {
  return selected !== undefined && use === "coalesce" &&
    rustSourceOptionalElementCarrier(source) !== undefined && rustSourceOptionalElementCarrier(selected) === undefined
    ? rustSourceOptionalTargetType(selected) : selected;
}
