import type { RustStructuralShapeDefinition } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { rustGenericsWithAssociatedBounds, rustGenericRequirementBounds } from "../types/generic-bounds.js";
import { rustGeneratedTypeParameterContext } from "../names/type-parameters.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustStructuralShapeContext<Context extends RustTypeRenderingContext>(
  definition: RustStructuralShapeDefinition, context: Context,
): Context & { readonly typeParameterNames: ReadonlyMap<string, string> } {
  return rustGeneratedTypeParameterContext(definition.genericParameters.filter(parameter => parameter.kind === "type"), [], context);
}

export function rustStructuralShapeGenerics(
  definition: RustStructuralShapeDefinition, context: RustTypeRenderingContext & Pick<RustPlanContext, "input">,
  placement: "complete" | "state",
): RustGenerics {
  const requirements = context.input.program.records.structuralGenerics.get(definition.carrier);
  if (requirements === undefined) failRustPlannerInvariant("A structural shape has no sealed generic requirements.");
  const parameters = placement === "state" ? definition.stateGenericParameters : definition.genericParameters;
  return rustGenericsWithAssociatedBounds(parameters.map(parameter => parameter.kind === "lifetime"
    ? { kind: "lifetime", name: parameter.lifetime.name, outlives: [] }
    : { kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name, bounds: rustGenericRequirementBounds(
      requirements.typeParameters.find(candidate => candidate.identity === parameter.identity)!.requirements) }),
  rustAssociatedPredicates(requirements.associatedTypes, context));
}
