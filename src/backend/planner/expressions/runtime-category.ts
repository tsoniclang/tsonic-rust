import type { RustTypeofResult } from "../../../target-model/types/runtime-kind.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustOperationFact } from "./fundamentals.js";
import { rustUnparenthesizedExpression } from "../../../target-model/syntax/expressions.js";
import { planExpressionBeforeValueProjections } from "./entry.js";
import { createRustSharedReferenceArgument } from "./input-shaping.js";
import { planRustDiscardedValue } from "./discarded-values.js";

export function planRustRuntimeCategoryExpression(node: Node, context: RustPlanContext): RustExpr {
  const { ast } = context.input.program.source;
  const fact = rustOperationFact(node, context);
  const source = Node_Expression(ast, node);
  const operand = source === undefined ? undefined : rustUnparenthesizedExpression(ast, source);
  if (fact?.kind !== "typeof" || operand === undefined)
    failRustPlannerInvariant("An admitted typeof requires its exact native category and checked operand.", node);
  if (typeof fact.result === "string") {
    const discarded = planRustDiscardedValue(operand, context)
      ?? failRustPlannerInvariant("An admitted static category requires its operand effects.", node);
    return { kind: "evaluate-then", effect: discarded.expression, discard: discarded.discard,
      value: { kind: "str-literal", value: fact.result } };
  }
  const value = planExpressionBeforeValueProjections(operand, context, "value", "shared-reference");
  if (value === undefined) failRustPlannerInvariant("An admitted runtime category requires its native operand.", node);
  return planRustRuntimeCategory(createRustSharedReferenceArgument(context,
    { stage: "source", expression: value, node: operand }), fact.result, context, true)
    ?? failRustPlannerInvariant("An admitted runtime category requires its selected native result.", node);
}

export function planRustRuntimeCategory(
  value: RustExpr,
  result: Exclude<RustTypeofResult, string>,
  context: RustPlanContext,
  borrowed = false,
): RustExpr | undefined {
  if (result.kind === "runtime-method") {
    return { kind: "method-call", receiver: rustAutoBorrowedReceiver(value),
      method: result.method, args: [] };
  }
  if (result.kind === "optional") {
    if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted runtime category requires its native bindings.", context.callableDeclaration ?? context.sourceFile);
    const binding = typeof result.value === "string" ? undefined : allocateRustSyntheticName(context.syntheticNames, "typeof_value");
    const expression = typeof result.value === "string" ? { kind: "str-literal" as const, value: result.value }
      : planRustRuntimeCategory({ kind: "path", path: binding! }, result.value, context, true);
    if (expression === undefined) return undefined;
    return { kind: "match", expression: borrowed ? value : { kind: "reference", expr: value }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [binding === undefined
        ? { kind: "wildcard" } : { kind: "binding", name: binding }] }, expression },
      { pattern: { kind: "path", path: "None" }, expression: { kind: "str-literal", value: "object" } },
    ] };
  }
  const path = rustUnionTypePathInContext(result.sourceCarrier, context);
  if (path === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted runtime union category requires its native identity and bindings.", context.callableDeclaration ?? context.sourceFile);
  const arms = result.variants.map((variant) => {
    const binding = typeof variant.result === "string" ? undefined
      : allocateRustSyntheticName(context.syntheticNames!, "typeof_value");
    const expression = typeof variant.result === "string" ? { kind: "str-literal" as const, value: variant.result }
      : planRustRuntimeCategory({ kind: "path", path: binding! }, variant.result, context, true);
    return expression === undefined ? undefined : {
      pattern: { kind: "tuple-variant" as const, path: `${path}::${variant.name}`,
        elements: [binding === undefined ? { kind: "wildcard" as const } : { kind: "binding" as const, name: binding }] },
      expression,
    };
  });
  return arms.some(arm => arm === undefined) ? undefined : {
    kind: "match", expression: borrowed ? value : { kind: "reference", expr: value }, arms: arms.map(arm => arm!),
  };
}
