import type { Node } from "@tsonic/tsts";
import { rustComputedMemberFactKey } from "../../../analysis/facts/operations/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";

export interface RustComputedMemberEvaluation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext;
}

export function prepareRustComputedMemberEvaluation(
  node: Node,
  context: RustPlanContext,
): RustComputedMemberEvaluation | undefined {
  const fact = context.input.program.facts.getFact(node, rustComputedMemberFactKey);
  if (fact === undefined || !fact.evaluateKey || context.expressionOverrides?.has(fact.key)) {
    return { bindings: [], context };
  }
  if (context.syntheticNames === undefined) return undefined;
  const key = planExpression(fact.key, context);
  const keyCarrier = effectivePlannedExpressionCarrier(fact.key, context);
  if (key === undefined || keyCarrier === undefined) return undefined;
  const keyName = allocateRustSyntheticName(context.syntheticNames, "_member_key");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.key, {
    expression: { kind: "path", path: keyName }, carrier: keyCarrier, valueForm: "value",
  });
  if (rustSourceFieldHasValueReceiver(node, context)) {
    const location = planRustValueFieldLocation(node, context,
      fact.accessMode === "read" ? "read" : "write");
    if (location === undefined) return undefined;
    const locations = new Map(context.valueFieldLocations ?? []);
    locations.set(node, { ...location, bindings: [] });
    return {
      bindings: [...location.bindings, { name: keyName, value: key }],
      context: { ...context, expressionOverrides: overrides, valueFieldLocations: locations },
    };
  }
  const receiver = planExpression(fact.receiver, context);
  const receiverCarrier = effectivePlannedExpressionCarrier(fact.receiver, context);
  if (receiver === undefined || receiverCarrier === undefined) return undefined;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "member_receiver");
  overrides.set(fact.receiver, {
    expression: { kind: "path", path: receiverName }, carrier: receiverCarrier, valueForm: "value",
  });
  return {
    bindings: [
      { name: receiverName, value: receiver },
      { name: keyName, value: key },
    ],
    context: { ...context, expressionOverrides: overrides },
  };
}

export function planRustComputedMemberExpression(
  node: Node,
  context: RustPlanContext,
  plan: (context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const evaluation = prepareRustComputedMemberEvaluation(node, context);
  if (evaluation === undefined) return undefined;
  const value = plan(evaluation.context);
  return value === undefined || evaluation.bindings.length === 0 ? value
    : { kind: "block", bindings: evaluation.bindings, value };
}
