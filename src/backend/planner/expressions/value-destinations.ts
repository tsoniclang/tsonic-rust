import type { Node } from "@tsonic/tsts";
import type { RustNativeStorageSelection } from "../../../analysis/callables/native-storage.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";

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
