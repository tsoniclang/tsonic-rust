import type { Node } from "@tsonic/tsts";
import type { RustEmissionProviderOperation } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";

export function planRustRuntimeIndexInputs(receiver: Node, index: Node, operation: RustEmissionProviderOperation,
  node: Node, prefix: string, context: RustPlanContext): {
    readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[]; readonly context: RustPlanContext;
  } {
  const selected = context.input.program.records.providerEvaluation.get(node, operation);
  if (context.syntheticNames === undefined || selected === undefined)
    failRustPlannerInvariant("An admitted indexed runtime operation requires its native evaluation plan and binding scope.", node);
  const overrides = new Map(context.expressionOverrides ?? []);
  const bindings: { name: string; value: RustExpr }[] = [];
  for (const [subject, suffix] of [[receiver, "receiver"], [index, "index"]] as const) {
    const borrowed = subject === receiver && selected.indexReceiverBorrow;
    const value = planExpression(subject, context, "value", borrowed ? "shared-reference" : "value");
    const carrier = effectivePlannedExpressionCarrier(subject, context);
    if (value === undefined || carrier === undefined)
      failRustPlannerInvariant("An admitted indexed runtime operation requires its exact native operand.", subject);
    const name = allocateRustSyntheticName(context.syntheticNames, `${prefix}_${suffix}`);
    bindings.push({ name, value });
    overrides.set(subject, { expression: { kind: "path", path: name }, carrier, valueForm: borrowed ? "shared-reference" : "value" });
  }
  return { bindings, context: { ...context, expressionOverrides: overrides } };
}
