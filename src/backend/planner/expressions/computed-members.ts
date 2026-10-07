import { rustValueBlock } from "../../target-ast/value-block.js";
import type { Node } from "@tsonic/tsts";
import { rustComputedMemberFactKey, rustTargetOperationFactKey } from "../../../analysis/facts/operations/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier } from "./fundamentals.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { planRustSourceAccessorReceiver, rustSourceAccessorHasValueReceiver } from "../objects/accessor-receivers.js";

export interface RustComputedMemberEvaluation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly context: RustPlanContext;
}

export function prepareRustComputedMemberEvaluation(
  node: Node,
  context: RustPlanContext,
): RustComputedMemberEvaluation | undefined {
  const fact = context.input.program.facts.getFact(node, rustComputedMemberFactKey);
  const ast = context.input.program.source.ast;
  const element = ast.is.IsElementAccessExpression(node) ? ast.as.AsElementAccessExpression(node) : undefined;
  const parent = ast.parent(node);
  const call = parent === undefined ? undefined
    : context.input.program.facts.getFact(parent, rustTargetOperationFactKey);
  if (fact !== undefined && (element === undefined || fact.receiver !== element.Expression ||
    fact.key !== element.ArgumentExpression) ||
    fact === undefined && element !== undefined && call?.kind === "source-call") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.computed-member-evaluation",
      "Computed source member requires its exact sealed receiver and key evaluation."));
    return undefined;
  }
  if (fact === undefined || !fact.evaluateKey || context.expressionOverrides?.has(fact.key)) {
    return { bindings: [], context };
  }
  if (context.syntheticNames === undefined) return undefined;
  const key = planExpression(fact.key, context, "discarded");
  const keyCarrier = effectivePlannedExpressionCarrier(fact.key, context);
  if (key === undefined || keyCarrier === undefined) return undefined;
  const evaluatedKey = planRustSharedReceiver(fact.key, key, context);
  const keyName = allocateRustSyntheticName(context.syntheticNames, "_member_key");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.key, {
    expression: { kind: "path", path: keyName }, carrier: keyCarrier, valueForm: "shared-reference",
  });
  if (!fact.evaluateReceiver) return {
    bindings: [{ name: keyName, value: evaluatedKey }],
    context: { ...context, expressionOverrides: overrides },
  };
  if (rustSourceAccessorHasValueReceiver(node, context)) {
    const evaluation = planRustSourceAccessorReceiver(node, [fact.key], context);
    if (evaluation === undefined) return undefined;
    if (evaluation.bindings.length !== 0) overrides.set(fact.receiver, {
      expression: evaluation.receiver, carrier: effectivePlannedExpressionCarrier(fact.receiver, context)!, valueForm: "storage",
    });
    return { bindings: [...evaluation.bindings, { name: keyName, value: evaluatedKey }],
      context: { ...context, expressionOverrides: overrides } };
  }
  if (rustSourceFieldHasValueReceiver(node, context)) {
    const location = planRustValueFieldLocation(node, context,
      fact.accessMode === "read" ? "read" : "write");
    if (location === undefined) return undefined;
    const locations = new Map(context.valueFieldLocations ?? []);
    locations.set(node, { ...location, bindings: [] });
    return {
      bindings: [...location.bindings, { name: keyName, value: evaluatedKey }],
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
      { name: keyName, value: evaluatedKey },
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
    : rustValueBlock(evaluation.bindings, value);
}
