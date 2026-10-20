import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionAccess } from "./entry.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planExpression } from "./entry.js";
import { applyRustValueConversion } from "./value-conversions.js";

export function planSourceConversion(node: Node, context: RustPlanContext, access: RustExpressionAccess = "value"): RustExpr | undefined {
  const selected = context.input.program.records.sourceAssertion.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted source assertion requires its exact native operand selection.", node);
  const value = planExpression(selected.operand, context, "value", selected.borrowed ? "shared-reference"
    : selected.conversion === undefined && access !== "value" ? "shared-place" : "value");
  if (value === undefined) failRustPlannerInvariant("An admitted source assertion requires its native input.", selected.operand);
  return selected.conversion === undefined ? value : applyRustValueConversion(context, value, selected.conversion, selected.operand, selected.borrowed);
}
