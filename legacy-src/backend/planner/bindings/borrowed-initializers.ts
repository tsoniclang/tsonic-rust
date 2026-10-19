import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/entry.js";

export function planRustBorrowedInitializer(
  expression: Node, context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr } | undefined {
  const selection = context.input.program.borrowedInitializers.forExpression(expression);
  const plannedReceiver = selection === undefined ? undefined : planExpression(selection.receiver, context);
  if (selection !== undefined && plannedReceiver === undefined) return undefined;
  const receiver = selection === undefined || plannedReceiver === undefined ? undefined
    : plannedReceiver;
  if (selection === undefined || receiver === undefined || context.input.program.ownership.reads.get(selection.receiver)?.readsStorage === true) {
    const value = planExpression(expression, context);
    return value === undefined ? undefined : { statements: [], value };
  }
  if (context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "borrowed_owner");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(selection.receiver, { expression: { kind: "path", path: name },
    carrier: selection.carrier, valueForm: "storage" });
  const value = planExpression(expression, { ...context, expressionOverrides: overrides });
  return value === undefined ? undefined : {
    statements: [{ kind: "let", name, mutable: false, init: receiver }], value,
  };
}
