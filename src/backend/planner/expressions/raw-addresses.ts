import type { Node } from "@tsonic/tsts";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustRawAddressPlan } from "../../../target-model/records/storage/raw-addresses.js";

export function planRustRawAddress(
  _node: Node, plan: RustRawAddressPlan, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const args: RustExpr[] = [];
  for (const argument of plan.arguments) {
    const value = planExpression(argument.expression, context);
    if (value === undefined) return undefined;
    args.push(argument.input === "raw-ref"
      ? { kind: "method-call", receiver: value, method: "as_ref", args: [] }
      : argument.input === "raw-owner-ref"
        ? { kind: "reference", expr: value }
      : argument.cast ? { kind: "numeric-cast", expression: value, target: argument.input } : value);
  }
  if ("width" in plan) args.push({ kind: "int-literal", text: `${plan.width}u32` });
  const call: RustExpr = { kind: "call", path: `rt::RawPointer::${plan.method}`, args };
  return plan.method === "address" && plan.width === 32
    ? { kind: "numeric-cast", expression: call, target: "u32" } : call;
}
