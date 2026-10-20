import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustNativeIntegerIdentity(
  node: Node,
  left: RustExpr,
  right: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  return selected?.kind !== "integer-identity" ? undefined : selected.operand === "left" ? left : right;
}
