import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustDiscardedValue } from "./discarded-values.js";
import { expressionCarrier, rustOperationFact } from "./fundamentals.js";

export function planRustVoidExpression(node: Node, context: RustPlanContext): RustExpr {
  const fact = rustOperationFact(node, context);
  const operand = Node_Expression(context.input.program.source.ast, node);
  if (fact?.kind !== "void-expression" || operand === undefined)
    failRustPlannerInvariant("An admitted void expression requires its exact operand and selected operation.", node);
  const discarded = planRustDiscardedValue(operand, context);
  const carrier = expressionCarrier(operand, context);
  const selected = carrier === undefined ? undefined : context.input.program.records.typeEmission.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted void operand requires its native completion.", operand);
  if (selected.completion === "never") return { kind: "bottom", expression: discarded.expression };
  return { kind: "evaluate-then", effect: discarded.expression, discard: discarded.discard, value: { kind: "tuple-literal", elements: [] } };
}
