import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { planCallExpression } from "./calls/basic.js";
import { planRegExpCreate } from "./regular-expression-literals.js";

export function planNewExpression(node: Node, context: RustPlanContext): RustExpr {
  const fact = context.input.program.records.targetOperation.get(node);
  if (fact?.kind === "regexp-create") return planRegExpCreate(node, context);
  if (fact?.kind === "source-call" && (fact.target.form === "constructor" || fact.target.form === "constructor-value")) {
    return planCallExpression(node, context)
      ?? failRustPlannerInvariant("An admitted source construction requires its native call.", node);
  }
  if (fact?.kind !== "provider-operation" || fact.abi.operationKind !== "constructor")
    failRustPlannerInvariant("An admitted construction requires its selected native constructor.", node);
  const planned = planProviderOperationExpression(context, fact, undefined,
    [...context.input.program.source.ast.arguments(node)], node, { resultUse: "value" });
  if (planned === undefined) failRustPlannerInvariant("An admitted provider constructor requires its native operation.", node);
  return finishProviderOperationExpression(context, fact, planned, node)
    ?? failRustPlannerInvariant("An admitted provider constructor requires its native result.", node);
}
