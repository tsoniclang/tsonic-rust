import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustMemoryBindingPlanKey } from "../../../target-model/operations/memory-bindings.js";
import { createRustStructuralObjectFromCarrier } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function tryPlanRustMemoryBinding(
  node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): { readonly handled: boolean; readonly expression?: RustExpr } {
  const plan = context.input.program.facts.getFact(node, rustMemoryBindingPlanKey);
  if (plan === undefined) return { handled: false };
  if (plan.kind === "field") return { handled: true, expression: planExpression(plan.expression, context) };
  if (context.syntheticNames === undefined) return { handled: true };
  const bindings: { name: string; value: RustExpr }[] = [];
  const fields: { kind: "bound"; value: RustExpr }[] = [];
  for (const field of plan.fields) {
    const value = planExpression(field.expression, context);
    if (value === undefined) return { handled: true };
    const name = allocateRustSyntheticName(context.syntheticNames, "field_location");
    bindings.push({ name, value });
    fields[field.storageIndex] = { kind: "bound", value: { kind: "path", path: name } };
  }
  const value = createRustStructuralObjectFromCarrier(plan.carrier, fields, context);
  return { handled: true, expression: value === undefined ? undefined : { kind: "block", bindings, value } };
}
