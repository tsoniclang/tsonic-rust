import type { Node } from "@tsonic/tsts";
import type { RustItem, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { planExpression } from "../../expressions/index.js";
import { planBlockLike } from "../../statements/index.js";
import { planRustModuleCell, rustModuleCellCallableAlias } from "../../project/module-storage.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustClassValues } from "../../objects/class-values.js";

export interface PlannedRustClassInitialization {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
}

export function planRustClassInitialization(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustClassInitialization {
  const values = planRustClassValues(declaration, context);
  if (values === undefined) failRustPlannerInvariant("An admitted class requires its native class-value initialization.", declaration);
  const items: RustItem[] = [...values.items];
  const initialization: RustStmt[] = [...values.initialization];
  const entries = context.input.program.records.classInitialization.get(declaration);
  if (entries === undefined) failRustPlannerInvariant("An admitted class requires its sealed native initialization order.", declaration);
  for (const selected of entries) {
    if (selected.kind === "block") {
      const planned = planBlockLike(selected.body, context);
      if (planned === undefined) failRustPlannerInvariant("An admitted static class block requires its native body plan.", selected.declaration);
      initialization.push({ kind: "scope", body: planned });
      continue;
    }
    const type = rustTypeFromCarrierInContext(selected.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted static class field requires its native storage type.", selected.declaration);
    const value = planExpression(selected.initializer, context);
    if (value === undefined || context.syntheticNames === undefined) {
      failRustPlannerInvariant("An admitted static class field requires its native initializer and local-name allocator.", selected.declaration);
    }
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(
      selected.name,
      type,
      value,
      "crate",
      context.syntheticNames,
      rustModuleCellCallableAlias(selected.carrier, context.input),
      [],
    );
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
