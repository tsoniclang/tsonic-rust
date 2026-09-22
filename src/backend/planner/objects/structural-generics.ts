import type { RustStructuralShapeDefinition } from "../../../analysis/objects/structural-shape-plan.js";
import type { RustGenerics } from "../../target-ast/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { rustGenericsWithAssociatedBounds, rustGenericRequirementBounds } from "../types/generic-bounds.js";

export function rustStructuralShapeGenerics(
  definition: RustStructuralShapeDefinition, context: RustTypeRenderingContext & Pick<RustPlanContext, "input">,
): RustGenerics {
  const requirements = context.input.program.declarationGenericRequirements.contractForCarrier(definition.carrier);
  if (requirements === undefined) throw new Error("A structural shape has no sealed generic requirements.");
  return rustGenericsWithAssociatedBounds(definition.genericParameters.map(parameter => parameter.kind === "lifetime"
    ? { kind: "lifetime", name: parameter.lifetime.name, outlives: [] }
    : { kind: "type", name: parameter.name, bounds: rustGenericRequirementBounds(
      requirements.typeParameters.find(candidate => candidate.name === parameter.name)!.requirements) }),
  rustAssociatedPredicates(requirements.associatedTypes, context));
}
