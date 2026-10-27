import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustNativeUnionProjection } from "./union-projections.js";
import { planExpression } from "./entry.js";
import { planProviderOperationExpression, finishProviderOperationExpression } from "./conversions.js";

export function planRustUnionProperty(node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "union-property" }>, context: RustPlanContext): RustExpr {
  const receiverNode = Node_Expression(context.input.program.source.ast, node)
    ?? failRustPlannerInvariant("An admitted union property requires its source receiver.", node);
  const receiver = planExpression(receiverNode, context, "value", "shared-reference")
    ?? failRustPlannerInvariant("An admitted union property requires its native receiver.", receiverNode);
  return planRustNativeUnionProjection(node, receiver, fact, context, variant => variant.operation,
    (payload, operation, index) => {
      const carrier = fact.variants[index]!.carrier;
      const expressionOverrides = new Map(context.expressionOverrides);
      expressionOverrides.set(receiverNode, { expression: payload, carrier, valueForm: "shared-reference" });
      const selectedContext = { ...context, expressionOverrides };
      const expression = planProviderOperationExpression(selectedContext, operation, receiverNode, [], node, {
        resultUse: "value", overrides: { sourceValues: new Map([[receiverNode, payload]]), inputs: new Map() },
      }) ?? failRustPlannerInvariant("An admitted union property arm requires its native operation.", node);
      return finishProviderOperationExpression(selectedContext, operation, expression, node);
    });
}
