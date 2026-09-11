import type { Node } from "@tsonic/tsts";
import { rustRawAddressPlanKey } from "../../../target-model/operations/raw-addresses.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustPrimitiveTypeName } from "../../../target-model/types/carriers/primitives.js";

export function tryPlanRustRawAddress(
  node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): { readonly handled: boolean; readonly expression?: RustExpr } {
  const plan = context.input.program.facts.getFact(node, rustRawAddressPlanKey);
  if (plan === undefined) return { handled: false };
  const args: RustExpr[] = [];
  for (const argument of plan.arguments) {
    const value = planExpression(argument.expression, context);
    if (value === undefined) return { handled: true };
    args.push(argument.input === "raw-ref"
      ? { kind: "method-call", receiver: planRustNonConsumingValue(argument.expression, value, context), method: "as_ref", args: [] }
      : argument.input === "raw-owner-ref"
        ? { kind: "reference", expr: planRustNonConsumingValue(argument.expression, value, context) }
      : argument.carrier.kind === "source-primitive" && rustPrimitiveTypeName(argument.carrier.name) === argument.input ||
          isUnsuffixedIntegerLiteral(value)
        ? value : { kind: "numeric-cast", expression: value, target: argument.input });
  }
  if ("width" in plan) args.push({ kind: "int-literal", text: `${plan.width}u32` });
  const call: RustExpr = { kind: "call", path: `rt::RawPointer::${plan.method}`, args };
  return { handled: true, expression: plan.method === "address" && plan.width === 32
    ? { kind: "numeric-cast", expression: call, target: "u32" } : call };
}

function isUnsuffixedIntegerLiteral(expression: RustExpr): boolean {
  const literal = expression.kind === "unary" && expression.operator === "-" ? expression.operand : expression;
  return literal.kind === "int-literal" &&
    /^-?(?:[0-9][0-9_]*|0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+)$/u.test(literal.text);
}
