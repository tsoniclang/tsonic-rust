import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionExit } from "../../../target-model/records/operations/expression-exits.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";

export function planRustExpressionExit(node: Node, selected: RustExpressionExit, context: RustPlanContext,
  expression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted eager exit requires its native evaluation scope.", node);
  const prefix = selected.prefix.map(operand => ({ name: allocateRustSyntheticName(names, "_evaluated_argument"),
    value: expression(operand, context) ?? failRustPlannerInvariant("An admitted eager exit requires every preceding source effect.", operand) }));
  const terminal = expression(selected.terminal, context)
    ?? failRustPlannerInvariant("An admitted eager exit requires its exact nonreturning source operand.", selected.terminal);
  return { kind: "bottom", expression: prefix.length === 0 ? terminal : rustValueBlock(prefix, terminal) };
}
