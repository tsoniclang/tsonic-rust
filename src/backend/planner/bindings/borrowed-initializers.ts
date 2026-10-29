import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/entry.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustBorrowedInitializer(
  expression: Node, context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr } | undefined {
  const selection = context.input.program.records.borrowedInitializer.get(expression);
  if (selection === undefined) {
    const value = planExpression(expression, context);
    if (value === undefined) failRustPlannerInvariant("An admitted initializer requires its native value plan.", expression);
    return { statements: [], value };
  }
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its native receiver and synthetic-name scope.", expression);
  const overrides = new Map(context.expressionOverrides ?? []);
  const statements: RustStmt[] = [];
  for (const retained of selection.retained) {
    const value = planExpression(retained.expression, { ...context, expressionOverrides: overrides });
    if (value === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its ordered native owner expression.", retained.expression);
    const name = allocateRustSyntheticName(context.syntheticNames, "borrowed_owner");
    statements.push({ kind: "let", name, mutable: false, init: value });
    overrides.set(retained.expression, { expression: { kind: "path", path: name },
      carrier: retained.carrier, valueForm: "storage", storageForm: "plain" });
  }
  const value = planExpression(expression, { ...context, expressionOverrides: overrides });
  if (value === undefined) failRustPlannerInvariant("An admitted borrowed initializer requires its native selected value.", expression);
  return {
    statements, value,
  };
}
