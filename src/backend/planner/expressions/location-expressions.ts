import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../../target-model/records/operations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

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
