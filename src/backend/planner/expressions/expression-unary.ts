import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionResultUse } from "./entry.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { planNumericLiteralWithCarrier } from "./literal-conversions.js";
import { negateRustPlannedBooleanExpression } from "./fundamentals.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planRustComputedMemberExpression } from "./computed-members.js";
import { planRustUpdateExpression } from "./update-source.js";

export function planUnaryExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse): RustExpr {
  const selected = context.input.program.records.unaryEmission.get(node)
    ?? failRustPlannerInvariant("An admitted unary expression requires its sealed native emission.", node);
  if (selected.kind === "update") return planRustComputedMemberExpression(selected.operand, context,
    selectedContext => planRustUpdateExpression(node, selected, resultUse, selectedContext))
    ?? failRustPlannerInvariant("An admitted update requires its native location evaluation.", node);
  const carrier = selected.kind === "identity" ? selected.carrier : selected.fact.resultCarrier;
  const operand = selected.literal ? planNumericLiteralWithCarrier(selected.operand, carrier, context)
    : planExpression(selected.operand, context) ?? failRustPlannerInvariant("An admitted unary expression requires its native operand.", selected.operand);
  if (selected.kind === "identity") return operand;
  const converted = applyRustValueConversion(context, selected.literal ? { stage: "finalized", expression: operand }
    : { stage: "source", expression: operand, node: selected.operand }, selected.fact.leftConversion, selected.operand)
    ?? failRustPlannerInvariant("An admitted unary expression requires its native operand conversion.", selected.operand);
  if (selected.booleanNot) return negateRustPlannedBooleanExpression(selected.operand, converted, context);
  if (selected.fact.operator !== "-" && selected.fact.operator !== "!") failRustPlannerInvariant("An admitted native unary requires its selected operator.", node);
  return { kind: "unary", operator: selected.fact.operator, operand: converted };
}
