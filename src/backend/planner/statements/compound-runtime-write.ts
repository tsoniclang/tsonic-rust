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

export function planRustCompoundRuntimeWrite(
  expression: Node, left: Node, right: Node, assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const write = context.input.program.facts.getFact(expression, rustCompoundWriteFactKey);
  const receiverNode = Node_Expression(context.input.program.source.ast, left);
  const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, left);
  if (write === undefined || receiverNode === undefined || indexNode === undefined || context.syntheticNames === undefined) return undefined;
  const overrides = new Map(context.expressionOverrides ?? []);
  const statements: RustStmt[] = [];
  for (const [subject, base] of [[receiverNode, "write_receiver"], [indexNode, "write_index"]] as const) {
    const value = planExpression(subject, context);
    const carrier = context.input.program.facts.getRuntimeCarrierFact(subject)?.carrier;
    if (value === undefined || carrier === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, base);
    statements.push({ kind: "let", name, mutable: false, init: value });
    overrides.set(subject, { expression: { kind: "path", path: name }, carrier, valueForm: "value" });
  }
  const selected = { ...context, expressionOverrides: overrides };
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
  const written = planRuntimeSetStatement(expression, write, selected, true);
  return written === undefined ? undefined : [{ kind: "scope", body: { statements: [...statements, ...written] } }];
}
