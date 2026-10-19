import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustBindingProjectionFact } from "../../../target-model/records/value-projections.js";
import { rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";

export function rustBindingProjectionCloneCarriers(fact: RustBindingProjectionFact): readonly TargetTypeRef[] {
  if (!("projectedCarrier" in fact)) return [];
  switch (fact.projection.kind) {
    case "js-array-element":
    case "js-array-rest": {
      const element = rustJsArrayLikeElementTargetType(fact.sourceCarrier);
      return element === undefined ? [] : [element];
    }
    case "object-rest": return fact.projection.fields.map(field => field.carrier);
    default: return [fact.projectedCarrier];
  }
}
