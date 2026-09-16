import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function locationMethodReceiver(
  expression: RustExpr | undefined,
): RustExpr | undefined {
  return expression?.kind === "method-call" &&
      expression.method === "clone" && expression.args.length === 0
    ? expression.receiver
    : expression;
}

export function locationIndexExpression(expression: RustExpr | undefined): RustExpr | undefined {
  if (expression?.kind === "index") {
    return expression.index;
  }
  return expression?.kind === "evaluate-then" && expression.value.kind === "index"
    ? {
        kind: "evaluate-then",
        effect: expression.effect,
        discard: expression.discard,
        value: expression.value.index,
      }
    : undefined;
}

export function typedLocationFactMatchesPlan(
  fact: Extract<RustTargetOperationFact, { readonly kind: "typed-location" }>,
  plan: RustTypedLocationPlan,
): boolean {
  return fact.operation === plan.operation &&
    rustTargetTypeRefEquals(fact.pointeeCarrier, plan.pointeeCarrier) &&
    rustTargetTypeRefEquals(fact.locationCarrier, plan.locationCarrier);
}

export function optionReference(value: RustExpr): RustExpr {
  return { kind: "method-call", receiver: value, method: "as_ref", args: [] };
}
