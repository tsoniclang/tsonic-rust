import type { RustTypeofResult } from "../../../target-model/types/runtime-kind.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustRuntimeCategory(
  value: RustExpr,
  result: Exclude<RustTypeofResult, string>,
  context: RustPlanContext,
  borrowed = false,
): RustExpr | undefined {
  const expression = planRuntimeCategory(value, result, context, borrowed);
  return expression === undefined ? undefined : { kind: "owned-string-from-borrowed-str", expression };
}

function planRuntimeCategory(
  value: RustExpr,
  result: Exclude<RustTypeofResult, string>,
  context: RustPlanContext,
  borrowed: boolean,
): RustExpr | undefined {
  if (result.kind === "runtime-method") {
    return { kind: "method-call", receiver: value,
      method: result.method, args: [] };
  }
  if (result.kind === "optional") {
    if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted runtime category requires its native bindings.", context.callableDeclaration ?? context.sourceFile);
    const binding = typeof result.value === "string" ? undefined : allocateRustSyntheticName(context.syntheticNames, "typeof_value");
    const expression = typeof result.value === "string" ? { kind: "str-literal" as const, value: result.value }
      : planRuntimeCategory({ kind: "path", path: binding! }, result.value, context, true);
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
      : planRuntimeCategory({ kind: "path", path: binding! }, variant.result, context, true);
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
