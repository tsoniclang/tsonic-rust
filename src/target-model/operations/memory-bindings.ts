import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import { defineRustPlanKey } from "../facts/keys.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export type RustMemoryBindingPlan = {
  readonly carrier: TargetTypeRef;
} & (
  | { readonly kind: "field"; readonly expression: Node }
  | { readonly kind: "record"; readonly fields: readonly {
    readonly expression: Node;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
  }[] }
);

export const rustMemoryBindingPlanKey = defineRustPlanKey<RustMemoryBindingPlan>("memoryBinding", (left, right) =>
  rustTargetTypeRefEquals(left.carrier, right.carrier) && (left.kind === "field"
    ? right.kind === "field" && left.expression === right.expression
    : right.kind === "record" && left.fields.length === right.fields.length && left.fields.every((field, index) => {
      const other = right.fields[index]!;
      return field.expression === other.expression && field.storageIndex === other.storageIndex &&
        rustTargetTypeRefEquals(field.carrier, other.carrier);
    })));
