import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableInvocationFact } from "../../../../target-model/records/callables/generic-callable-effects.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import { planRustGenericCallableErrorJoin } from "../../declarations/callables/generic-errors.js";
import { rustInjectNativeError, rustPropagateMappedErrorJoin } from "../../program/fallible-boundaries.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustGenericCallableErrorPropagation(
  node: Node, selection: RustGenericCallableInvocationFact, channel: "invocation" | "awaiting",
  expression: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  const active = context.fallibleBoundary;
  const operand = planRustGenericCallableErrorJoin(selection.ownerFileName, selection[channel],
    selection.effects[channel] === "fallible" ? "result" : "value", context);
  const result = active === undefined || operand === undefined || context.syntheticNames === undefined ? undefined
    : rustPropagateMappedErrorJoin(active, operand, expression,
      allocateRustSyntheticName(context.syntheticNames, "generic_error"),
      allocateRustSyntheticName(context.syntheticNames, "generic_error_payload"),
      (source, value) => rustInjectNativeError(active, source, value));
  if (result === undefined) failRustPlannerInvariant("An admitted generic invocation requires its physical member error channels in the active region.", node);
  return result;
}
