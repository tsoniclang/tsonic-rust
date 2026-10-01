import type { RustUnionPathStep } from "../../../target-model/types/union-relations.js";
import type { RustPattern, RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustUnionPattern(
  path: readonly RustUnionPathStep[],
  payload: RustPattern,
  context: RustPlanContext,
): RustPattern | undefined {
  let pattern = payload;
  for (const step of [...path].reverse()) {
    const type = rustTypeFromCarrierInContext(step.union, context);
    if (type?.kind !== "named") return undefined;
    pattern = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
      : { kind: "tuple-variant", path: `${type.path}::${step.variant.name}`, elements: [pattern] };
  }
  return pattern;
}

export function planRustUnionConstruction(
  path: readonly RustUnionPathStep[],
  payload: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  let expression = payload;
  for (const step of [...path].reverse()) {
    const type = rustTypeFromCarrierInContext(step.union, context);
    if (type?.kind !== "named") return undefined;
    expression = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
      : { kind: "call", path: `${type.path}::${step.variant.name}`, args: [expression] };
  }
  return expression;
}
