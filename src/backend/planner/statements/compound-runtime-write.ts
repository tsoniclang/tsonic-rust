import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { rustCompoundWriteFactKey } from "../../../analysis/facts/operations/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustAssignmentOperationPlan } from "./core.js";
import type { RustStmt } from "../../target-ast/nodes.js";
import { planExpression } from "../expressions/entry.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCompoundAssignmentValue } from "./assignments.js";
import { planRuntimeSetStatement } from "./iteration.js";
import { planRustRuntimeIndexInputs } from "../expressions/runtime-index-inputs.js";

export function planRustCompoundRuntimeWrite(
  expression: Node, left: Node, right: Node, assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const write = context.input.program.facts.getFact(expression, rustCompoundWriteFactKey);
  const receiverNode = Node_Expression(context.input.program.source.ast, left);
  const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, left);
  if (write === undefined || receiverNode === undefined || indexNode === undefined || context.syntheticNames === undefined) return undefined;
  const inputs = planRustRuntimeIndexInputs(receiverNode, indexNode, write.abi, "write", context);
  if (inputs === undefined) return undefined;
  const selected = inputs.context;
  const overrides = new Map(selected.expressionOverrides);
  const statements: RustStmt[] = inputs.bindings.map(binding => ({ kind: "let", name: binding.name, mutable: false, init: binding.value }));
  const current = planExpression(left, selected);
  const value = planExpression(right, context);
  if (current === undefined || value === undefined) return undefined;
  const currentName = allocateRustSyntheticName(context.syntheticNames, "write_current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "write_value");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "write_next");
  const next = planRustCompoundAssignmentValue(assignment, { kind: "path", path: currentName },
    { kind: "path", path: valueName }, left, context);
  if (next === undefined) return undefined;
  statements.push({ kind: "let", name: currentName, mutable: false, init: current },
    { kind: "let", name: valueName, mutable: false, init: value },
    { kind: "let", name: nextName, mutable: false, init: next });
  overrides.set(right, { expression: { kind: "path", path: nextName }, carrier: assignment.resultCarrier, valueForm: "value" });
  const written = planRuntimeSetStatement(expression, write, { ...selected, expressionOverrides: overrides }, { target: left, value: right });
  return written === undefined ? undefined : [{ kind: "scope", body: { statements: [...statements, ...written] } }];
}
