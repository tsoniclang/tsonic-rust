import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustAwaitValueFactKey, rustAwaitValueMatchesCarrier } from "../../../analysis/facts/await-values.js";
import { rustEffectiveValueCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { requireExpressionCarrier, rustOperationFact } from "./fundamentals.js";
import { planRustAwaitBranches } from "./await-branches.js";

export function planRustAwaitExpression(
  node: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const operation = rustOperationFact(node, context);
  const operand = Node_Expression(context.input.program.source.ast, node);
  const fact = context.input.program.facts.getFact(node, rustAwaitValueFactKey);
  const operandCarrier = rustEffectiveValueCarrier(context.input.program.facts, operand);
  if (operation?.kind !== "await-op" || fact === undefined ||
    !rustAwaitValueMatchesCarrier(fact, operandCarrier, operation.resultCarrier, context.input.program.typeDefinitions)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.await-value", "Await expressions require one finalized native branch/effect/conversion contract."));
    return undefined;
  }
  if (!requireExpressionCarrier(node, operation.resultCarrier, context, "rust.backend.await-carrier")) return undefined;
  const planned = operand === undefined ? undefined : planExpression(operand, context);
  return planned === undefined ? undefined : planRustAwaitBranches(node, planned, fact, context);
}
