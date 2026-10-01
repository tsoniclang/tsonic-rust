import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planRustNativeUnionProjection } from "./union-projections.js";
import { planExpression } from "./entry.js";
import { planProviderOperationExpression, finishProviderOperationExpression } from "./conversions.js";
import { requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { effectiveMemberResultCarrier } from "./special.js";

export function planRustUnionProperty(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "union-property" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  if (resultCarrier === undefined || !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.union-property") ||
    !selectedOperationMatches(context.input.program.facts.getSelectedTargetProperty(node), fact.operationId, "property", resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.union-property",
      "Native union property conflicts with its exact selected operation evidence."));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context, "value", "shared-reference");
  if (receiverNode === undefined || receiver === undefined) return undefined;
  return planRustNativeUnionProjection(node, receiver, fact, context, variant => variant.operation,
    (payload, operation, index) => {
      const carrier = fact.variants[index]!.carrier;
      if (operation.abi.operationKind !== "property" || operation.abi.sourceArguments.length !== 0 ||
        operation.abi.sourceReceiver.kind !== "receiver" || !rustTargetTypeRefEquals(operation.abi.sourceReceiver.carrier, carrier) ||
        !rustTargetTypeRefEquals(operation.resultCarrier, fact.resultCarrier)) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.union-property-arm",
          "Native union property arm conflicts with its exact receiver or result ABI."));
        return undefined;
      }
      const expressionOverrides = new Map(context.expressionOverrides);
      expressionOverrides.set(receiverNode, { expression: payload, carrier, valueForm: "shared-reference" });
      const selectedContext = { ...context, expressionOverrides };
      const expression = planProviderOperationExpression(selectedContext, operation, receiverNode, [], node, { resultUse: "value" });
      return expression === undefined ? undefined : finishProviderOperationExpression(selectedContext, operation, expression, node);
    });
}
