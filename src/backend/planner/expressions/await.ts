import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planRustAwaitBranches } from "./await-completions.js";

export function planRustAwaitExpression(node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const operand = Node_Expression(context.input.program.source.ast, node);
  const fact = context.input.program.records.awaitValue.get(node);
  if (operand === undefined || fact === undefined) failRustPlannerInvariant("An admitted await requires its native operand and completion selection.", node);
  const planned = planExpression(operand, context)
    ?? failRustPlannerInvariant("An admitted await requires its native operand plan.", operand);
  return planRustAwaitBranches(node, planned, fact, context);
}
