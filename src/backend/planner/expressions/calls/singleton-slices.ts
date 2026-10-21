import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { canBorrowRustSingletonSlice, planRustBorrowedSingletonSlice } from "./rest-assembly.js";
import { planExpression } from "../entry.js";

export function planRustSourceCallArgumentValue(argument: Node, context: RustPlanContext, borrowedInputs: Map<Node, RustExpr>): RustExpr | undefined {
  const selected = context.input.program.records.sourceCallArgument.get(argument)
    ?? failRustPlannerInvariant("An admitted source argument requires its exact native evaluation plan.", argument);
  if (selected.kind === "singleton" && canBorrowRustSingletonSlice(selected.element, context, selected.later)) {
    const planned = planRustBorrowedSingletonSlice(selected.element, context);
    if (planned !== undefined) borrowedInputs.set(argument, planned);
    return planned;
  }
  return planExpression(argument, context);
}
