import type { Node } from "@tsonic/tsts";
import type { RustEmissionProviderOperation } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";
import { planRustDirectStorage, planRustUpdateProjectionArguments } from "./update-target.js";

export function planRustRuntimeWriteInputs(operation: RustEmissionProviderOperation,
  node: Node, prefix: string, context: RustPlanContext): {
    readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[]; readonly context: RustPlanContext;
  } {
  const selected = context.input.program.records.providerEvaluation.get(node, operation);
  const mutable = context.input.program.records.providerMutableOperands.get(node, operation);
  const admitted = context.input.program.records.runtimeSetter.get(node);
  if (context.syntheticNames === undefined || selected === undefined || mutable === undefined || admitted === undefined)
    failRustPlannerInvariant("An admitted runtime write requires its native evaluation plan, source inputs and binding scope.", node);
  const overrides = new Map(context.expressionOverrides ?? []);
  const bindings: { name: string; value: RustExpr; mutable?: boolean }[] = [];
  for (const slot of selected.source.slots) {
    const receiver = slot.source.kind === "receiver";
    if (!receiver && (operation.abi.operationKind !== "index-set" || slot.source.row.sourceIndex !== 0)) continue;
    const subject = slot.node;
    const suffix = receiver ? "receiver" : "index";
    const carrier = effectivePlannedExpressionCarrier(subject, context);
    if (carrier === undefined) failRustPlannerInvariant("An admitted runtime write requires its exact native operand carrier.", subject);
    const storage = mutable.find(input => input.key === slot.key)?.storage;
    if (receiver && storage?.kind === "direct") {
      const projection = selected.effects.has(slot.key)
        ? planRustUpdateProjectionArguments(subject, undefined, { ...context, expressionOverrides: overrides }) : undefined;
      if (selected.effects.has(slot.key) && projection === undefined)
        failRustPlannerInvariant("An admitted runtime write requires its exact native receiver projection arguments.", subject);
      if (projection !== undefined) {
        bindings.push(...projection.bindings);
        for (const override of projection.overrides) overrides.set(override.node, override.value);
      }
      const place = planRustDirectStorage(subject, { ...context, expressionOverrides: overrides }, projection?.inputOverrides)
        ?? failRustPlannerInvariant("An admitted runtime write requires its exact native receiver storage.", subject);
      overrides.set(subject, { expression: place, carrier, valueForm: "storage", storageForm: "plain" });
      continue;
    }
    const borrowed = receiver && selected.indexReceiverBorrow;
    const value = planExpression(subject, context, "value", borrowed ? "shared-reference" : "value");
    if (value === undefined) failRustPlannerInvariant("An admitted runtime write requires its exact native operand.", subject);
    const name = allocateRustSyntheticName(context.syntheticNames, `${prefix}_${suffix}`);
    bindings.push({ name, value, ...(storage?.kind === "owned" ? { mutable: true } : {}) });
    overrides.set(subject, { expression: { kind: "path", path: name }, carrier, valueForm: borrowed ? "shared-reference" : "value" });
  }
  return { bindings, context: { ...context, expressionOverrides: overrides } };
}
