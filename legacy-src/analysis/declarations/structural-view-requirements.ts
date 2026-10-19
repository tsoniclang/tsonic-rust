import type { RustProjectStructuralView } from "../objects/project-structural-views.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement } from "./generic-requirements.js";

export function rustStructuralViewRequirementUses(
  view: RustProjectStructuralView, bindings?: RustTargetGenericBindings,
): readonly { readonly carrier: TargetTypeRef; readonly requirements: readonly RustGenericRequirement[] }[] {
  return view.fields.flatMap(member => member.field === undefined || member.field.dispatch !== undefined
    ? [] : [{ carrier: bindings === undefined ? member.field.resultCarrier
      : substituteRustTargetGenerics(member.field.resultCarrier, bindings.types, bindings.lifetimes, bindings.consts),
      requirements: ["clone"] as const }]);
}
