import type { RustTypeofResult } from "../../../analysis/facts/operations/facts.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
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
  if (result.kind === "runtime-union") {
    return rustRuntimeUnionContract(result.sourceCarrier)?.typeofMethod !== result.method ? undefined
      : { kind: "method-call", receiver: value, method: result.method, args: [] };
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
