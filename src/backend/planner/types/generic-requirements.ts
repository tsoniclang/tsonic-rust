import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustCarrierHasCopyContract(
  carrier: TargetTypeRef | undefined,
  context: RustPlanContext,
): boolean {
  return isRustCopyCarrier(carrier, selected =>
    context.input.program.callableValues.generic.definitionFor(selected)?.copy === true);
}
