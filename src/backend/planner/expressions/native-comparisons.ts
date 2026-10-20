import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustPartialOrderingTest } from "../../target-ast/syntax/comparisons.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";

export function planEmptyStringComparison(node: Node, left: RustExpr, right: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  if (selected?.kind !== "empty-string") return undefined;
  const value: RustExpr = { kind: "method-call", receiver: selected.operand === "left" ? left : right, method: "is_empty", args: [] };
  return selected.negated ? { kind: "unary", operator: "!", operand: value } : value;
}

export function planBooleanLiteralComparison(node: Node, left: RustExpr, right: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  if (selected?.kind !== "boolean") return undefined;
  const value = selected.operand === "left" ? left : right;
  return selected.negated ? { kind: "unary", operator: "!", operand: value } : value;
}

export function planRustRangeContainment(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  if (selected?.kind !== "range") return undefined;
  const subject = planExpression(selected.subject, context);
  const lower = planExpression(selected.lower, context);
  const upper = planExpression(selected.upper, context);
  if (subject === undefined || lower === undefined || upper === undefined) return undefined;
  let value: RustExpr;
  if (selected.form === "outside-float") value = { kind: "binary", operator: "||",
    left: rustPartialOrderingTest(subject, lower, "==", "Less"), right: rustPartialOrderingTest(subject, upper, "==", "Greater") };
  else {
    const contains: RustExpr = { kind: "method-call", receiver: { kind: "range", start: lower, end: upper, inclusive: true },
      method: "contains", args: [{ kind: "reference", expr: subject }] };
    value = selected.operator === "&&" ? contains : { kind: "unary", operator: "!", operand: contains };
  }
  if (selected.prefix !== undefined) {
    const prefix = planExpression(selected.prefix, context);
    if (prefix === undefined) return undefined;
    value = { kind: "binary", operator: selected.operator, left: prefix, right: value };
  }
  if (selected.suffix !== undefined) {
    const suffix = planExpression(selected.suffix, context);
    if (suffix === undefined) return undefined;
    value = { kind: "binary", operator: selected.operator, left: value, right: suffix };
  }
  return value;
}
