import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";

export function planRustRuntimeSetExpression(expression: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "runtime-set" }>, context: RustPlanContext): RustExpr {
  const admitted = context.input.program.records.runtimeSetter.get(expression)
    ?? failRustPlannerInvariant("Runtime setter requires its admitted native source operands and ABI correspondence.", expression);
  const native = planProviderOperationExpression(context, fact, admitted.receiver, admitted.sourceArguments, expression, { resultUse: "value" })
    ?? failRustPlannerInvariant("An admitted runtime setter requires its native operation plan.", expression);
  return finishProviderOperationExpression(context, fact, native, expression)
    ?? failRustPlannerInvariant("An admitted runtime setter requires its native completion plan.", expression);
}
