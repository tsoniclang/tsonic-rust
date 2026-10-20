import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { Node_Expression, ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planProviderOperationExpression, finishProviderOperationExpression } from "./conversions.js";

export function planDeleteExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = context.input.program.records.targetOperation.get(node);
  const ast = context.input.program.source.ast;
  const operand = Node_Expression(ast, node);
  const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
  const index = operand === undefined ? undefined : ElementAccessExpression_ArgumentExpression(ast, operand);
  if (fact?.kind !== "provider-operation" || fact.abi.operationKind !== "indexer" || receiver === undefined || index === undefined)
    failRustPlannerInvariant("An admitted element deletion requires its selected native operation and source inputs.", node);
  const planned = planProviderOperationExpression(context, fact, receiver, [index], node, { resultUse: "value" });
  if (planned === undefined) failRustPlannerInvariant("An admitted deletion requires its native operation expression.", node);
  return finishProviderOperationExpression(context, fact, planned, node);
}
