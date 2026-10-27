import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

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
