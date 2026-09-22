import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function rustStructuralDispatchType(carrier: TargetTypeRef, context: RustPlanContext): RustType | undefined {
  const type = rustTypeFromCarrierInContext(carrier, context);
  const shape = context.input.program.structuralShapes.definitionForCarrier(carrier);
  return type?.kind !== "named" || shape?.dispatchName === undefined ? undefined : {
    ...type, path: `${type.path.slice(0, type.path.lastIndexOf("::") + 2)}${shape.dispatchName}`,
  };
}
