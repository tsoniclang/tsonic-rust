import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustAssignmentOperationFact } from "./operator-selection.js";

export type RustAssignmentEvaluation = {
  readonly left: Node;
  readonly right: Node;
  readonly valueField: boolean;
  readonly copy: boolean;
  readonly operands: readonly { readonly node: Node; readonly carrier: TargetTypeRef; readonly role: "receiver" | "index";
    readonly storage: "value" | "shared-reference" | "direct" | "direct-identifier" }[];
} & (
  | { readonly kind: "compound"; readonly fact: RustAssignmentOperationFact }
  | { readonly kind: "nullish"; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "nullish-assignment" }>;
      readonly rightForm: "value" | "before-context" }
);
