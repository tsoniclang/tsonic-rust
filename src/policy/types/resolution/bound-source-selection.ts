import type { Type } from "@tsonic/tsts";
import { sourceBoundTypeRelationship } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceSelectionUsesExactBindings(
  authored: Type,
  selected: Type,
  context: RustTargetTypeResolutionContext,
): boolean {
  return (context.sourceTypeParameterSubstitutions?.size ?? 0) > 0 &&
    sourceBoundTypeRelationship(authored, selected, context.currentSemantics,
      declaration => context.sourceTypeParameterSubstitutions?.get(declaration)?.sourceType) === "bound";
}
