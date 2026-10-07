import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/entry.js";
import { planRustNonConsumingValue } from "../expressions/typed-locations.js";

export function planRustBorrowedInitializer(
  expression: Node, context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr } | undefined {
  const selection = context.input.program.borrowedInitializers.forExpression(expression);
  const plannedReceiver = selection === undefined ? undefined : planExpression(selection.receiver, context);
  if (selection !== undefined && plannedReceiver === undefined) return undefined;
  const receiver = selection === undefined || plannedReceiver === undefined ? undefined
    : planRustNonConsumingValue(selection.receiver, plannedReceiver, context);
  if (selection === undefined || receiver === undefined || stablePlace(receiver)) {
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

function stablePlace(expression: RustExpr): boolean {
  return expression.kind === "path" || expression.kind === "field" && stablePlace(expression.receiver) ||
    expression.kind === "dereference" && stablePlace(expression.pointer);
}
