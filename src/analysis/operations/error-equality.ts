import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectRustProgramErrorComparison } from "../../policy/operations/operators/error-equality.js";

export function selectRustProgramErrorEquality(
  walk: RustFactWalk, left: TargetTypeRef | undefined, right: TargetTypeRef | undefined, negated: boolean,
) {
  const projects = new Map<TargetTypeRef, { readonly variant: string; readonly carrier: TargetTypeRef }>();
  for (const carrier of [left, right]) {
    if (carrier === undefined) continue;
    const definition = walk.context.projectTypes.definitionForCarrier(carrier);
    const variant = definition === undefined ? undefined : walk.context.projectTypes.programErrorVariant(definition);
    if (definition?.kind === "class" && variant !== undefined)
      projects.set(carrier, Object.freeze({ variant, carrier: walk.context.projectTypes.openCarrier(definition) }));
  }
  return selectRustProgramErrorComparison(left, right, negated, walk.context.typeDefinitions, projects);
}
