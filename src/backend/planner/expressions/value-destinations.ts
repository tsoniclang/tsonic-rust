import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { planExpression } from "./entry.js";

export function rustValueDestinationContext(expression: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext): RustPlanContext {
  if (carrier === undefined) return context;
  const valueDestinations = new Map(context.valueDestinations);
  valueDestinations.set(expression, carrier);
  return { ...context, valueDestinations };
}

export function rustReturnValueContext(expression: Node, context: RustPlanContext): RustPlanContext {
  const declaration = context.callableDeclaration;
  if (declaration === undefined) return context;
  const selected = context.input.program.records.callableReturn.get(declaration)?.destination
    ?? failRustPlannerInvariant("An admitted callable return requires its exact native destination.", expression);
  return selected.kind === "identity" ? context : rustValueDestinationContext(expression, selected.carrier, context);
}

export function planRustReturnValueExpression(expression: Node, context: RustPlanContext, planValue: typeof planExpression): RustExpr | undefined {
  const selected = rustReturnValueContext(expression, context);
  const declaration = context.callableDeclaration;
  const borrowed = declaration !== undefined && context.input.program.records.sourceCallableReturn.get(declaration)?.borrowedParameter !== undefined;
  return planValue(expression, selected, "value", borrowed ? "shared-reference" : "value");
}
