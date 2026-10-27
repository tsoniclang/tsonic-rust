import type { Node } from "@tsonic/tsts";

import type { RustPlanContext } from "../program/plan-context.js";
import type { RustAssignmentOperationPlan } from "../../../target-model/records/operations/operator-selection.js";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import { planExpression } from "../expressions/entry.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCompoundAssignmentValue } from "./assignments.js";
import { planRuntimeSetStatement } from "./statement-loops.js";
import { planRustRuntimeWriteInputs } from "../expressions/runtime-index-inputs.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustCompoundRuntimeWrite(
  expression: Node, left: Node, right: Node, assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] {
  const write = context.input.program.records.compoundWrite.get(expression);
  if (write === undefined || context.syntheticNames === undefined) {
    failRustPlannerInvariant("An admitted compound write lost its native setter or name scope.", expression);
  }
  const inputs = planRustRuntimeWriteInputs(write, expression, "write", context);
  const selected = inputs.context;
  const overrides = new Map(selected.expressionOverrides);
  const statements: RustStmt[] = inputs.bindings.map(binding => ({ kind: "let", name: binding.name, mutable: binding.mutable ?? false, init: binding.value }));
  const current = planExpression(left, selected);
  const value = planExpression(right, context);
  if (current === undefined || value === undefined) {
    failRustPlannerInvariant("An admitted compound write lost its rendered source operands.", expression);
  }
  const currentName = allocateRustSyntheticName(context.syntheticNames, "write_current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "write_value");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "write_next");
  const next = planRustCompoundAssignmentValue(assignment, { kind: "path", path: currentName },
    { kind: "path", path: valueName }, left, context);
  if (next === undefined) failRustPlannerInvariant("An admitted compound write lost its selected native operator rendering.", expression);
  statements.push({ kind: "let", name: currentName, mutable: false, init: current },
    { kind: "let", name: valueName, mutable: false, init: value },
    { kind: "let", name: nextName, mutable: false, init: next });
  overrides.set(right, { expression: { kind: "path", path: nextName }, carrier: assignment.resultCarrier, valueForm: "value" });
  const written = planRuntimeSetStatement(expression, write, { ...selected, expressionOverrides: overrides });
  if (written === undefined) failRustPlannerInvariant("An admitted compound write lost its selected native setter rendering.", expression);
  return [{ kind: "scope", body: { statements: [...statements, ...written] } }];
}
