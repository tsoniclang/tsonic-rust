import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { RustAssignmentOperationFact } from "../operations/operator-selection.js";
import type { RustValueReadOwnership } from "./ownership.js";

export type RustAssignmentEvaluation = {
  readonly left: Node;
  readonly right: Node;
  readonly copy: boolean;
  readonly operands: readonly { readonly node: Node; readonly carrier: TargetTypeRef; readonly role: "receiver" | "index";
    readonly storage: "value" | "shared-reference" | "direct" | "direct-identifier" }[];
} & (
  | { readonly kind: "compound"; readonly fact: RustAssignmentOperationFact;
      readonly current: { readonly kind: "field" } | { readonly kind: "value" }
        | { readonly kind: "direct"; readonly ownership: RustValueReadOwnership } }
  | { readonly kind: "nullish"; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "nullish-assignment" }>;
      readonly valueField: boolean;
      readonly rightForm: "value" | "before-context" }
);
