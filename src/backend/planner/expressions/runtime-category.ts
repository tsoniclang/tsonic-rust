import { getRustTypeofRuntimeKind, type RustTypeofResult } from "../../../target-model/types/runtime-kind.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustUnionTypePathInContext } from "../types/render.js";

export function planRustRuntimeCategory(
  value: RustExpr,
  result: Exclude<RustTypeofResult, string>,
  context: RustPlanContext,
  borrowed = false,
): RustExpr | undefined {
  const selected = getRustTypeofRuntimeKind(result.sourceCarrier, context.input.program.typeDefinitions);
  if (selected === undefined || closedMetadataKey(selected) !== closedMetadataKey(result)) return undefined;
  return planRuntimeCategory(value, result, context, borrowed);
}

function planRuntimeCategory(
  value: RustExpr,
  result: Exclude<RustTypeofResult, string>,
  context: RustPlanContext,
  borrowed: boolean,
): RustExpr | undefined {
  if (result.kind === "runtime-method") {
    return { kind: "owned-string-from-borrowed-str",
      expression: { kind: "method-call", receiver: value, method: result.method, args: [] } };
  }
  if (result.kind === "optional") {
    if (context.syntheticNames === undefined) return undefined;
    const binding = typeof result.value === "string" ? undefined : allocateRustSyntheticName(context.syntheticNames, "typeof_value");
    const expression = typeof result.value === "string" ? { kind: "string-literal" as const, value: result.value }
      : planRuntimeCategory({ kind: "path", path: binding! }, result.value, context, true);
    if (expression === undefined) return undefined;
    return { kind: "match", expression: borrowed ? value : { kind: "reference", expr: value }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [binding === undefined
        ? { kind: "wildcard" } : { kind: "binding", name: binding }] }, expression },
      { pattern: { kind: "path", path: "None" }, expression: { kind: "string-literal", value: "object" } },
    ] };
  }
  const path = rustUnionTypePathInContext(result.sourceCarrier, context);
  const variants = context.input.program.typeDefinitions.sourceUnionVariants(result.sourceCarrier);
  if (path === undefined || context.syntheticNames === undefined || variants?.length !== result.variants.length) return undefined;
  const arms = result.variants.map((variant, index) => {
    const declared = variants[index];
    if (declared?.name !== variant.name || !rustTargetTypeRefEquals(declared.carrier, variant.carrier)) return undefined;
    const binding = typeof variant.result === "string" ? undefined
      : allocateRustSyntheticName(context.syntheticNames!, "typeof_value");
    const expression = typeof variant.result === "string" ? { kind: "string-literal" as const, value: variant.result }
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
