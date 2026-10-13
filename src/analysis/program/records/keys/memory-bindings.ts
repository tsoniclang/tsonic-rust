import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustMemoryBindingPlan } from "../../../../target-model/records/memory-bindings.js";

export const rustMemoryBindingPlanKey = defineRustPlanKey<RustMemoryBindingPlan>("memoryBinding", (left, right) =>
  rustTargetTypeRefEquals(left.carrier, right.carrier) && (left.kind === "field"
    ? right.kind === "field" && left.expression === right.expression
    : right.kind === "record" && left.fields.length === right.fields.length && left.fields.every((field, index) => {
      const other = right.fields[index]!;
      return field.expression === other.expression && field.storageIndex === other.storageIndex &&
        rustTargetTypeRefEquals(field.carrier, other.carrier);
    })));
