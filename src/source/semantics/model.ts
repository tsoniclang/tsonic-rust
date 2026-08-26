import type {
  Node,
  ProviderDeclarationIdentity,
  Type,
} from "@tsonic/tsts";

export type RustSourceTypeContractFact =
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

export interface RustSourceGenericParameterFact {
  readonly parameter: Node;
  readonly owner: Node;
  readonly kind: "lifetime" | "type";
  readonly constraint?: Node;
  readonly defaultType?: Node;
  readonly bounds: readonly Node[];
  readonly outlives: readonly Node[];
  readonly typeOutlives: readonly Node[];
  readonly maybeSized: boolean;
}

export type RustSourceReferenceOperationKind =
  | "shared-reference"
  | "mutable-reference"
  | "load"
  | "store";

interface RustSourceReferenceOperationFactBase {
  readonly call: Node;
  readonly resultType: Type;
  readonly selectedDeclaration: ProviderDeclarationIdentity;
}

export type RustSourceReferenceOperationFact =
  | RustSourceReferenceOperationFactBase & {
      readonly kind: "shared-reference" | "mutable-reference";
      readonly valueExpression: Node;
      readonly valueType: Type;
      readonly lifetimeTypeNode?: Node;
    }
  | RustSourceReferenceOperationFactBase & {
      readonly kind: "load";
      readonly referenceExpression: Node;
      readonly referenceType: Type;
    }
  | RustSourceReferenceOperationFactBase & {
      readonly kind: "store";
      readonly referenceExpression: Node;
      readonly referenceType: Type;
      readonly valueExpression: Node;
      readonly valueType: Type;
    };
