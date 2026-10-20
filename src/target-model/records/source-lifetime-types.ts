import type { Node } from "@tsonic/tsts";

export type RustSourceLifetimeTypeContract =
  | { readonly kind: "lifetime-kind" }
  | { readonly kind: "static-lifetime" }
  | { readonly kind: "placeholder-lifetime" }
  | {
      readonly kind: "shared-reference" | "mutable-reference";
      readonly targetTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | { readonly kind: "outlives" | "valid-for"; readonly lifetimeTypeNode: Node }
  | {
      readonly kind: "trait-object";
      readonly traitTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | { readonly kind: "capture-set"; readonly tupleTypeNode: Node }
  | {
      readonly kind: "opaque-type";
      readonly boundTypeNode: Node;
      readonly captureTypeNode?: Node;
    }
  | { readonly kind: "maybe-sized" };
