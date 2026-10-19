import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

import { createRustStructuralObjectFromCarrier } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustEmptyObjectTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustMemoryBindingPlan } from "../../../target-model/records/memory-bindings.js";

export function planRustMemoryBinding(
  _node: Node, plan: RustMemoryBindingPlan, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (plan.kind === "field") return planExpression(plan.expression, context);
  if (rustTargetTypeRefEquals(plan.carrier, rustEmptyObjectTargetType())) {
    return plan.fields.length === 0
      ? { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] }
      : undefined;
  }
  if (context.syntheticNames === undefined) return undefined;
  const bindings: { name: string; value: RustExpr }[] = [];
  const fields: { kind: "bound"; value: RustExpr }[] = [];
  for (const field of plan.fields) {
    const value = planExpression(field.expression, context);
    if (value === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "field_location");
    bindings.push({ name, value });
    fields[field.storageIndex] = { kind: "bound", value: { kind: "path", path: name } };
  }
  const value = createRustStructuralObjectFromCarrier(plan.carrier, fields, context);
  return value === undefined ? undefined : bindings.length === 0 ? value : rustValueBlock(bindings, value);
}
