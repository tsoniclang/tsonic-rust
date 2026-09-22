import type { RustProjectProjectionRequirement } from "../../../target-model/types/project-projections.js";
import { rustTargetTypeParameterNames } from "../../../target-model/types/carriers/generic-references.js";
import type { RustWherePredicate } from "../../target-ast/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "./render.js";

export function rustProjectProjectionPredicates(
  requirements: readonly RustProjectProjectionRequirement[], context: RustTypeRenderingContext,
): readonly RustWherePredicate[] {
  return Object.freeze(requirements.flatMap(requirement => {
    if ([requirement.sourceCarrier, requirement.targetCarrier].flatMap(rustTargetTypeParameterNames).length === 0) return [];
    const source = rustTypeFromCarrierInContext(requirement.sourceCarrier, context);
    const target = rustTypeFromCarrierInContext(requirement.targetCarrier, context);
    if (source === undefined || target === undefined) throw new Error("A finalized project projection bound lost its native type.");
    return [{ kind: "type" as const, type: target, bounds: [{ kind: "trait-type" as const, reference: {
      trait: { kind: "named" as const, path: "core::convert::TryFrom", genericArguments: [
        { kind: "type" as const, type: source },
        { kind: "associated-equality" as const, name: "Error", genericArguments: [], type: { kind: "unit" as const } },
      ] },
    } }] }];
  }));
}
