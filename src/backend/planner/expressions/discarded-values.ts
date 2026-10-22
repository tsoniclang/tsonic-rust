import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { expressionCarrier } from "./fundamentals.js";

export interface RustDiscardedValue {
  readonly expression: RustExpr;
  readonly discard: "unit" | "value";
}

export function planRustDiscardedValue(node: Node, context: RustPlanContext): RustDiscardedValue {
  const carrier = expressionCarrier(node, context);
  if (carrier === undefined) failRustPlannerInvariant("An admitted discarded expression requires its native carrier.", node);
  const discard = context.input.program.records.typeEmission.get(carrier)?.discard;
  if (discard === undefined) failRustPlannerInvariant("An admitted discarded expression requires its native completion contract.", node);
  const borrowed = context.input.program.records.readOwnership.get(node)?.readsStorage === true;
  const expression = planExpression(node, context, borrowed ? "value" : "discarded", borrowed ? "shared-reference" : "value")
    ?? failRustPlannerInvariant("An admitted discarded expression requires its native effect.", node);
  // A discarded Promise is planned to its unit observation (planRustDiscardedPromise), so nothing remains to bind.
  if (!borrowed && context.input.program.records.promiseResult.get(node)?.discard !== undefined) return { expression, discard: "unit" };
  return borrowed ? { expression, discard: "value" } : discard === "drop"
    ? { expression: { kind: "call", path: "core::mem::drop", args: [expression] }, discard: "unit" }
    : { expression, discard };
}
