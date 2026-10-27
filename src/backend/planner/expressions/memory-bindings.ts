import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

import { createRustStructuralObjectFromCarrier } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustMemoryBindingPlan } from "../../../target-model/records/storage/memory-bindings.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustMemoryBinding(
  node: Node, plan: RustMemoryBindingPlan, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (plan.kind === "field") return planExpression(plan.expression, context);
  const emission = context.input.program.records.typeEmission.get(plan.carrier);
  if (emission === undefined) failRustPlannerInvariant("An admitted bound record requires its native representation.", node);
  if (emission.emptyRecord === "native-empty") {
    if (plan.fields.length !== 0) failRustPlannerInvariant("An admitted native empty record has no field locations.", node);
    return { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] };
  }
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted bound record requires hygienic location names.", node);
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
