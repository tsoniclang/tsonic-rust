import type { Node } from "@tsonic/tsts";
import type { RustGenericRequirement } from "../../../analysis/declarations/generic-requirements.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCarrierSupportsClone } from "../../../target-model/types/index.js";
import { unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export type { RustGenericRequirement } from "../../../analysis/declarations/generic-requirements.js";

export function rustCarrierHasCloneContract(
  carrier: TargetTypeRef | undefined,
  context: RustPlanContext,
): boolean {
  return carrier !== undefined && (rustCarrierSupportsClone(carrier) ||
    context.callableDeclaration !== undefined &&
    context.input.program.declarationGenericRequirements.supportsClone(context.callableDeclaration, carrier));
}

export function requireRustLocationValueCarrier(
  carrier: TargetTypeRef,
  node: Node,
  context: RustPlanContext,
): boolean {
  return requireRustCarrierRequirements(
    carrier,
    ["clone", "static"],
    node,
    context,
  );
}

export function requireRustDefaultValueCarrier(
  carrier: TargetTypeRef,
  node: Node,
  context: RustPlanContext,
): boolean {
  return requireRustCarrierRequirements(carrier, ["default"], node, context);
}

export function requireRustCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  node: Node,
  context: RustPlanContext,
): boolean {
  const declaration = context.callableDeclaration;
  if (declaration === undefined) {
    return true;
  }
  if (context.input.program.declarationGenericRequirements.hasUse(
    declaration,
    node,
    carrier,
    required,
  )) {
    return true;
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.generic-requirement-classification",
    "A generated Rust operation is absent from its sealed callable generic-requirement contract.",
  ));
  return false;
}
