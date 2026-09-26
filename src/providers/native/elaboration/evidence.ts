export type RustCompilerData = null | boolean | number | string |
  readonly RustCompilerData[] | { readonly [key: string]: RustCompilerData };

export interface RustNativeDefinitionId {
  readonly krate: number;
  readonly index: number;
}

export interface RustNativeNodeId {
  readonly owner: RustNativeDefinitionId;
  readonly local: number;
}

export interface RustNativeSourceSpan {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly context: readonly {
    readonly expansion: RustNativeDefinitionId;
    readonly transparency: "opaque" | "semi-opaque" | "transparent";
  }[];
  readonly expansion: RustNativeDefinitionId;
}

export interface RustNativeOccurrence {
  readonly id: RustNativeNodeId;
  readonly kind: "expression" | "pattern";
  readonly source: RustNativeSourceSpan | null;
  readonly type: number;
  readonly adjustedType: number;
  readonly resolution:
    | { readonly kind: "declaration"; readonly id: RustNativeDefinitionId }
    | { readonly kind: "binding"; readonly id: RustNativeNodeId }
    | null;
}

export interface RustNativeTypeRow {
  readonly id: number;
  readonly kind: RustCompilerData;
  readonly signature: RustCompilerData;
}

export interface RustNativeDefinition {
  readonly id: RustNativeDefinitionId;
  readonly publicId: number;
  readonly parent: RustNativeDefinitionId | null;
  readonly path: string;
  readonly name: string | null;
  readonly kind: string;
  readonly macroKinds: readonly ("function-like" | "attribute" | "derive")[];
  readonly type: number | null;
  readonly generics: RustCompilerData;
  readonly source: RustNativeSourceSpan | null;
}

export interface RustNativeExpansion {
  readonly id: RustNativeDefinitionId;
  readonly parent: RustNativeDefinitionId;
  readonly kind: "root" | "function-like" | "attribute" | "derive" | "compiler-pass" | "desugaring";
  readonly name: string;
  readonly definition: RustNativeDefinitionId | null;
  readonly callSite: RustNativeSourceSpan | null;
  readonly definitionSite: RustNativeSourceSpan | null;
}

export interface RustNativeEvidence {
  readonly inputs: readonly RustNativeSourceInput[];
  readonly occurrences: readonly RustNativeOccurrence[];
  readonly types: readonly RustNativeTypeRow[];
  readonly expansions: readonly RustNativeExpansion[];
  readonly definitions: readonly RustNativeDefinition[];
  readonly effects: readonly RustNativeBodyEffects[];
}

export interface RustNativeBodyEffects {
  readonly owner: RustNativeDefinitionId;
  readonly accesses: readonly RustNativeAccess[];
}

export interface RustNativeAccess {
  readonly kind: "move" | "use-cloned" | "copy" | "borrow-shared" | "borrow-unique-shared" |
    "borrow-mutable" | "mutate" | "bind" | "fake-read";
  readonly place: RustNativeNodeId;
  readonly diagnostic: RustNativeNodeId;
  readonly source: RustNativeSourceSpan | null;
  readonly base:
    | { readonly kind: "temporary" | "static" }
    | { readonly kind: "local"; readonly binding: RustNativeNodeId }
    | { readonly kind: "capture"; readonly binding: RustNativeNodeId; readonly closure: RustNativeDefinitionId };
  readonly projections: readonly (
    | { readonly kind: "dereference" | "index" | "subslice" | "opaque-cast" | "unwrap-unsafe-binder" }
    | { readonly kind: "field"; readonly field: number; readonly variant: number }
  )[];
  readonly fakeRead: {
    readonly reason: "match-guard" | "matched-place" | "guard-binding" | "let" | "index";
    readonly closure: RustNativeDefinitionId | null;
  } | null;
}

export interface RustNativeSourceInput {
  readonly path: string;
  readonly byteLength: number;
  readonly digest: string;
}

export function nativeDefinitionKey(identity: RustNativeDefinitionId): string {
  return `${identity.krate}:${identity.index}`;
}

export function nativeNodeKey(identity: RustNativeNodeId): string {
  return `${nativeDefinitionKey(identity.owner)}:${identity.local}`;
}
