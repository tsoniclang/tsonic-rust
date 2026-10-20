import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { Node } from "@tsonic/tsts";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustIntegerTruncation(
  expression: RustExpr,
  context: RustPlanContext,
  node: Node,
): RustExpr | undefined {
  const selected = context.input.program.records.integerTruncation.get(node)
    ?? failRustPlannerInvariant("An admitted integer truncation requires its native call form.", node);
  const type = rustTypeFromCarrierInContext(selected.target, context);
  if (type?.kind !== "primitive") failRustPlannerInvariant("An admitted integer truncation requires its exact native scalar target.", node);
  return {
    kind: "numeric-cast", target: type.name,
    expression,
  };
}
