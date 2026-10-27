import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustAssignmentOperator } from "../../syntax/tokens.js";

export type RustReferenceOperationRecipe =
  | { readonly kind: "shared-reference" }
  | { readonly kind: "mutable-reference" }
  | { readonly kind: "load"; readonly form: "reference" | "owned-string" | "dereference" }
  | { readonly kind: "store"; readonly valueExpression: Node; readonly evaluation:
      | { readonly kind: "direct" }
      | { readonly kind: "compound"; readonly operator: Exclude<RustAssignmentOperator, "="> }
      | { readonly kind: "value-first" }
      | { readonly kind: "target-first"; readonly target: "value" | "mutable-reborrow" } };

export type RustReferenceOperationEmission =
  | { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "shared-reference" }>;
      readonly recipe: Extract<RustReferenceOperationRecipe, { readonly kind: "shared-reference" }> }
  | { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "mutable-reference" }>;
      readonly recipe: Extract<RustReferenceOperationRecipe, { readonly kind: "mutable-reference" }> }
  | { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "load" }>;
      readonly recipe: Extract<RustReferenceOperationRecipe, { readonly kind: "load" }> }
  | { readonly operation: Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "store" }>;
      readonly recipe: Extract<RustReferenceOperationRecipe, { readonly kind: "store" }> };
