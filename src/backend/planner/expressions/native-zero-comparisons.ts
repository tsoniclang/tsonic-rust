import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planFinalizedSourceInput } from "./conversions.js";

export function planRustNativeZeroComparison(node: Node, left: RustExpr, right: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  if (selected?.kind !== "unsigned-constant" && selected?.kind !== "unsigned-zero") return undefined;
  const expression = selected.operand === "left" ? left : right;
  if (selected.kind === "unsigned-constant") {
    const value: RustExpr = { kind: "bool-literal", value: selected.value };
    return selected.evaluate ? { kind: "evaluate-then", effect: expression, discard: "value", value } : value;
  }
  if (selected.empty === undefined)
    return { kind: "binary", operator: selected.operator, left: expression, right: { kind: "int-literal", text: "0" } };
  const receiver = planFinalizedSourceInput(context, selected.empty.input, selected.empty.receiver, [], node, "target-receiver");
  if (receiver === undefined) return undefined;
  const check: RustExpr = { kind: "method-call", receiver, method: selected.empty.method, args: [] };
  return selected.operator === "==" ? check : { kind: "unary", operator: "!", operand: check };
}
