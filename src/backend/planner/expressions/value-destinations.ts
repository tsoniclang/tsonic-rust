import type { Node } from "@tsonic/tsts";
import type { RustNativeStorageSelection } from "../../../analysis/callables/native-storage.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { planExpression } from "./entry.js";
import { rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";

export function rustValueDestinationContext(
  expression: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext,
): RustPlanContext {
  if (carrier === undefined) return context;
  const valueDestinations = new Map(context.valueDestinations);
  valueDestinations.set(expression, carrier);
  return { ...context, valueDestinations };
}

export function rustSelectedValueDestinationContext(
  expression: Node, selection: RustNativeStorageSelection, context: RustPlanContext,
): RustPlanContext | undefined {
  if (selection.kind === "unresolved") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, expression),
      "rust.backend.value-destination", selection.reason));
    return undefined;
  }
  return selection.kind === "identity" ? context : rustValueDestinationContext(expression, selection.carrier, context);
}

export function rustReturnValueContext(expression: Node, context: RustPlanContext): RustPlanContext | undefined {
  const declaration = context.callableDeclaration;
  return declaration === undefined ? context : rustSelectedValueDestinationContext(expression,
    context.input.program.callableValues.nativeStorage.returnFor(declaration), context);
}

export function planRustReturnValueExpression(
  expression: Node, context: RustPlanContext, planValue: typeof planExpression,
): RustExpr | undefined {
  const selected = rustReturnValueContext(expression, context);
  if (selected === undefined) return undefined;
  const declaration = context.callableDeclaration;
  const borrowed = declaration !== undefined &&
    context.input.program.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.borrowedParameter !== undefined;
  return planValue(expression, selected, "value", borrowed ? "shared-reference" : "value");
}
