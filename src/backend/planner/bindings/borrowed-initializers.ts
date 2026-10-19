import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/entry.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustBorrowedInitializer(
  expression: Node, context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr } | undefined {
  const selection = context.input.program.records.borrowedInitializer.get(expression);
  const plannedReceiver = selection === undefined ? undefined : planExpression(selection.receiver, context);
  if (selection !== undefined && plannedReceiver === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its native owner expression.", expression);
  const receiver = selection === undefined || plannedReceiver === undefined ? undefined
    : plannedReceiver;
  if (selection === undefined) {
    const value = planExpression(expression, context);
    if (value === undefined) failRustPlannerInvariant("An admitted initializer requires its native value plan.", expression);
    return { statements: [], value };
  }
  if (context.syntheticNames === undefined || receiver === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its native receiver and synthetic-name scope.", expression);
  const name = allocateRustSyntheticName(context.syntheticNames, "borrowed_owner");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(selection.receiver, { expression: { kind: "path", path: name },
    carrier: selection.carrier, valueForm: "storage" });
  const value = planExpression(expression, { ...context, expressionOverrides: overrides });
  if (value === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its native selected value.", expression);
  return {
    statements: [{ kind: "let", name, mutable: false, init: receiver }], value,
  };
}
