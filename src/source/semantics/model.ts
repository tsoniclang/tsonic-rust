import type {
  Node,
  ProviderDeclarationIdentity,
  Type,
} from "@tsonic/tsts";

export type RustSourceTypeContractFact =
  | { readonly kind: "lifetime-kind" }
  | { readonly kind: "static-lifetime" }
  | { readonly kind: "owned"; readonly targetTypeNode: Node }
  | {
      readonly kind: "shared-reference";
      readonly targetTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | {
      readonly kind: "mutable-reference";
      readonly targetTypeNode: Node;
      readonly lifetimeTypeNode?: Node;
    }
  | { readonly kind: "outlives"; readonly lifetimeTypeNode: Node }
  | { readonly kind: "valid-for"; readonly lifetimeTypeNode: Node }
  | { readonly kind: "const-parameter"; readonly valueTypeNode: Node }
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
  | { readonly kind: "maybe-sized" }
  | {
      readonly kind: "function-pointer";
      readonly parameterTypesNode: Node;
      readonly resultTypeNode: Node;
      readonly abiTypeNode?: Node;
      readonly safetyTypeNode?: Node;
      readonly variadicTypeNode?: Node;
    }
  | { readonly kind: "rust-char" };

export interface RustSourceGenericParameterFact {
  readonly parameter: Node;
  readonly owner: Node;
  readonly kind: "lifetime" | "type" | "const";
  readonly constraint?: Node;
  readonly defaultType?: Node;
  readonly bounds: readonly Node[];
  readonly constValueType?: Node;
  readonly outlives: readonly Node[];
  readonly typeOutlives: readonly Node[];
  readonly maybeSized: boolean;
}

export type RustSourceOwnershipOperationKind =
  | "shared-borrow"
  | "mutable-borrow"
  | "move"
  | "clone"
  | "own"
  | "load"
  | "store"
  | "replace"
  | "take"
  | "capture-move";

export interface RustSourceOwnershipOperationFact {
  readonly kind: RustSourceOwnershipOperationKind;
  readonly call: Node;
  readonly valueExpression: Node;
  readonly valueType: Type;
  readonly replacementExpression?: Node;
  readonly replacementType?: Type;
  readonly resultType: Type;
  readonly selectedDeclaration: ProviderDeclarationIdentity;
}

export type RustSourcePointerOperationFact =
  | {
      readonly kind: "expose-address";
      readonly call: Node;
      readonly pointerExpression: Node;
      readonly pointerType: Type;
      readonly mutable: boolean;
      readonly resultType: Type;
      readonly selectedDeclaration: ProviderDeclarationIdentity;
    }
  | {
      readonly kind: "restore-exposed-address";
      readonly call: Node;
      readonly addressExpression: Node;
      readonly addressType: Type;
      readonly pointeeType: Type;
      readonly explicitPointeeTypeNode?: Node;
      readonly mutable: boolean;
      readonly resultType: Type;
      readonly selectedDeclaration: ProviderDeclarationIdentity;
    }
  | {
      readonly kind: "read-volatile";
      readonly call: Node;
      readonly pointerExpression: Node;
      readonly pointerType: Type;
      readonly pointeeType: Type;
      readonly explicitPointeeTypeNode?: Node;
      readonly resultType: Type;
      readonly selectedDeclaration: ProviderDeclarationIdentity;
    }
  | {
      readonly kind: "write-volatile";
      readonly call: Node;
      readonly pointerExpression: Node;
      readonly pointerType: Type;
      readonly valueExpression: Node;
      readonly valueType: Type;
      readonly pointeeType: Type;
      readonly explicitPointeeTypeNode?: Node;
      readonly resultType: Type;
      readonly selectedDeclaration: ProviderDeclarationIdentity;
    };

export interface RustSourceDeclarationBuilderState {
  readonly kind: "builder-state";
  readonly call: Node;
  readonly applicationTarget: Node;
  readonly selectedDeclaration: ProviderDeclarationIdentity;
}

export type RustSourceDeclarationApplication =
  | { readonly operation: "extern"; readonly abiExpression: Node }
  | { readonly operation: "variadic" }
  | { readonly operation: "repr-c" }
  | { readonly operation: "repr-transparent" }
  | { readonly operation: "repr-packed"; readonly alignmentExpression: Node }
  | { readonly operation: "repr-align"; readonly alignmentExpression: Node }
  | { readonly operation: "union" }
  | { readonly operation: "mutable-static" }
  | { readonly operation: "thread-local" }
  | { readonly operation: "unsafe-trait" }
  | { readonly operation: "unsafe-impl"; readonly traitTypeNode: Node }
  | { readonly operation: "negative-impl"; readonly traitTypeNode: Node }
  | { readonly operation: "drop" };

export interface RustSourceDeclarationApplicationFact {
  readonly kind: "application";
  readonly call: Node;
  readonly applicationTarget: Node;
  readonly application: RustSourceDeclarationApplication;
  readonly predecessor?: Node;
  readonly selectedDeclaration: ProviderDeclarationIdentity;
}

export type RustSourceDeclarationFact =
  | RustSourceDeclarationBuilderState
  | RustSourceDeclarationApplicationFact;
