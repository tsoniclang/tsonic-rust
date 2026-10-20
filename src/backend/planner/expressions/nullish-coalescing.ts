import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression, planExpressionBeforeOptionProjection, planExpressionBeforeValueProjections } from "./entry.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planRustOptionBranch } from "./option-branch.js";

export function planNullishCoalescing(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nullishCoalescing.get(node)
    ?? failRustPlannerInvariant("An admitted nullish coalescing requires its exact native operand and depth plan.", node);
  const fact = selected.operation;
  let left = planExpressionBeforeOptionProjection(selected.left, context);
  let right = fact.rightValueForm === "raw" ? planExpressionBeforeValueProjections(selected.right, context, "value") : planExpression(selected.right, context);
  if (left === undefined || right === undefined) return undefined;
  for (let depth = 1; depth < fact.leftOptionDepth; depth++) left = { kind: "method-call", receiver: left, method: "flatten", args: [] };
  for (let depth = 1; depth < fact.rightOptionDepth; depth++) right = { kind: "method-call", receiver: right, method: "flatten", args: [] };
  const presentName = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "present_value");
  const value: RustExpr = { kind: "path", path: presentName };
  const present = fact.leftConversion === undefined ? value : applyRustValueConversion(context, value, fact.leftConversion, node, false);
  if (present === undefined) return undefined;
  return planRustOptionBranch(left, selected.leftCarrier, presentName,
    fact.rightOptionDepth > 0 ? { kind: "call", path: "Some", args: [present] } : present, right, context);
}
