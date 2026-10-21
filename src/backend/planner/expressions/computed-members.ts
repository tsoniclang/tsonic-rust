import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { planRustSourceAccessorReceiver, rustSourceAccessorHasValueReceiver } from "../objects/accessor-receivers.js";
import { rustCarrierHasCopyContract } from "../types/generic-requirements.js";

export interface RustComputedMemberEvaluation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly context: RustPlanContext;
}

export function prepareRustComputedMemberEvaluation(node: Node, context: RustPlanContext): RustComputedMemberEvaluation {
  const fact = context.input.program.records.computedMember.get(node);
  if (fact === undefined || !fact.evaluateKey || context.expressionOverrides?.has(fact.key)) return { bindings: [], context };
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted computed member requires its native name scope.", node);
  const key = planExpression(fact.key, context, "discarded");
  const keyCarrier = effectivePlannedExpressionCarrier(fact.key, context);
  if (key === undefined || keyCarrier === undefined)
    failRustPlannerInvariant("An admitted computed member requires its native key and carrier.", fact.key);
  const copyKey = rustCarrierHasCopyContract(keyCarrier, context);
  const evaluatedKey = copyKey ? key : planRustSharedReceiver(fact.key, key, context);
  if (evaluatedKey === undefined) failRustPlannerInvariant("An admitted computed member requires its native shared key read.", fact.key);
  const keyName = allocateRustSyntheticName(names, "_member_key");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.key, { expression: { kind: "path", path: keyName }, carrier: keyCarrier,
    valueForm: copyKey ? "value" : "shared-reference" });
  if (!fact.evaluateReceiver) return { bindings: [{ name: keyName, value: evaluatedKey }], context: { ...context, expressionOverrides: overrides } };
  if (rustSourceAccessorHasValueReceiver(node, context)) {
    const evaluation = planRustSourceAccessorReceiver(node, [fact.key], context)
      ?? failRustPlannerInvariant("An admitted computed accessor requires its native receiver.", fact.receiver);
    if (evaluation.bindings.length !== 0) overrides.set(fact.receiver, {
      expression: evaluation.receiver,
      carrier: effectivePlannedExpressionCarrier(fact.receiver, context)
        ?? failRustPlannerInvariant("An admitted computed accessor requires its native receiver carrier.", fact.receiver),
      valueForm: "storage",
    });
    return { bindings: [...evaluation.bindings, { name: keyName, value: evaluatedKey }], context: { ...context, expressionOverrides: overrides } };
  }
  if (rustSourceFieldHasValueReceiver(node, context)) {
    const location = planRustValueFieldLocation(node, context, fact.accessMode === "read" ? "read" : "write")
      ?? failRustPlannerInvariant("An admitted computed field requires its native receiver location.", fact.receiver);
    const locations = new Map(context.valueFieldLocations ?? []);
    locations.set(node, { ...location, bindings: [] });
    return { bindings: [...location.bindings, { name: keyName, value: evaluatedKey }],
      context: { ...context, expressionOverrides: overrides, valueFieldLocations: locations } };
  }
  const receiver = planExpression(fact.receiver, context);
  const receiverCarrier = effectivePlannedExpressionCarrier(fact.receiver, context);
  if (receiver === undefined || receiverCarrier === undefined)
    failRustPlannerInvariant("An admitted computed member requires its native receiver and carrier.", fact.receiver);
  const receiverName = allocateRustSyntheticName(names, "member_receiver");
  overrides.set(fact.receiver, { expression: { kind: "path", path: receiverName }, carrier: receiverCarrier, valueForm: "value" });
  return { bindings: [{ name: receiverName, value: receiver }, { name: keyName, value: evaluatedKey }],
    context: { ...context, expressionOverrides: overrides } };
}

export function planRustComputedMemberExpression(node: Node, context: RustPlanContext,
  plan: (context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const evaluation = prepareRustComputedMemberEvaluation(node, context);
  const value = plan(evaluation.context);
  return value === undefined || evaluation.bindings.length === 0 ? value : rustValueBlock(evaluation.bindings, value);
}
