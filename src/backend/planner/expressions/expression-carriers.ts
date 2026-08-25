import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustSealedExpressionCarrier(
  node: Node,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ??
    context.input.program.ownership.executionCarrierFor(node) ??
    context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
}
