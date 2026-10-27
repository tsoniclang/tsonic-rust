import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCarrierReadEmission } from "../../../target-model/records/storage/carrier-reads.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function requireRustCarrierRead(carrier: TargetTypeRef, context: Pick<RustPlanContext, "input">, node?: Node): RustCarrierReadEmission {
  const selected = context.input.program.records.carrierRead.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted native value read requires its sealed ownership disposition.", node);
  return selected;
}
