import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustStructuralDispatchType(carrier: TargetTypeRef, context: RustPlanContext): RustType | undefined {
  const type = rustTypeFromCarrierInContext(carrier, context);
  const shape = context.input.program.records.structuralShape.get(carrier);
  if (type?.kind !== "named" || shape?.dispatchName === undefined) failRustPlannerInvariant("An admitted structural dispatch requires its exact native shape and named carrier.");
  return {
    ...type, path: `${type.path.slice(0, type.path.lastIndexOf("::") + 2)}${shape.dispatchName}`,
  };
}
