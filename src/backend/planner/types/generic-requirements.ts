import type { Node } from "@tsonic/tsts";
import type { RustGenericRequirement } from "../../../target-model/records/types/generic-requirements.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";


export function rustCarrierHasCopyContract(carrier: TargetTypeRef | undefined, context: RustPlanContext): boolean {
  if (carrier === undefined) return false;
  const selected = context.input.program.records.carrierRead.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted carrier read requires its sealed native Copy guarantee.", context.callableDeclaration ?? context.sourceFile);
  return selected.copy;
}

export function rustCarrierHasCloneContract(carrier: TargetTypeRef | undefined, context: RustPlanContext): boolean {
  if (carrier === undefined) return false;
  if (context.callableDeclaration !== undefined) {
    const selected = context.input.program.records.carrierClone.get(carrier, context.callableDeclaration, context.promiseBody);
    if (selected === undefined) failRustPlannerInvariant("An admitted native clone requires its exact declaration-owned guarantee.", context.callableDeclaration);
    return selected;
  }
  const selected = context.input.program.records.carrierRead.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted native clone requires its sealed carrier guarantee.", context.sourceFile);
  return selected.clone;
}

export function requireRustLocationValueCarrier(carrier: TargetTypeRef, node: Node, context: RustPlanContext): boolean {
  return requireRustCarrierRequirements(carrier, ["clone", "static"], node, context);
}

export function requireRustDefaultValueCarrier(carrier: TargetTypeRef, node: Node, context: RustPlanContext): boolean {
  return requireRustCarrierRequirements(carrier, ["default"], node, context);
}

export function requireRustCarrierRequirements(
  carrier: TargetTypeRef, required: readonly RustGenericRequirement[], node: Node, context: RustPlanContext,
): boolean {
  const declaration = context.callableDeclaration;
  if (declaration !== undefined &&
    context.input.program.records.genericRequirementUse.get(declaration, node, carrier, required, context.promiseBody) !== true)
    failRustPlannerInvariant("An admitted native operation requires its exact sealed generic-requirement use.", node);
  return true;
}
