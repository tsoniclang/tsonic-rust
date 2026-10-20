import type { RustUnionPathStep } from "../../../target-model/types/union-relations.js";
import type { RustPattern, RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustUnionPattern(
  path: readonly RustUnionPathStep[],
  payload: RustPattern,
  context: RustPlanContext,
): RustPattern | undefined {
  let pattern = payload;
  for (const step of [...path].reverse()) {
    const type = rustTypeFromCarrierInContext(step.union, context);
    if (type?.kind !== "named") failRustPlannerInvariant("An admitted union pattern requires its native type identity.", context.callableDeclaration ?? context.sourceFile);
    pattern = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
      : { kind: "tuple-variant", path: `${type.path}::${step.variant.name}`, elements: [pattern] };
  }
  return pattern;
}

export function planRustUnionConstruction(
  path: readonly RustUnionPathStep[],
  payload: RustExpr,
  context: RustTypeRenderingContext,
): RustExpr | undefined {
  let expression = payload;
  for (const step of [...path].reverse()) {
    const type = rustTypeFromCarrierInContext(step.union, context);
    if (type?.kind !== "named") failRustPlannerInvariant("An admitted union construction requires its native type identity.");
    expression = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
      : { kind: "call", path: `${type.path}::${step.variant.name}`, args: [expression] };
  }
  return expression;
}
