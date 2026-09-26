import type { RustNativeConstant, RustNativeGenerics, RustNativeType } from "./type-model.js";
import type { RustNativeScope, RustNativeVisibility } from "./scope-model.js";
import type { RustNativeOccurrence } from "./occurrence-model.js";
export type { RustNativeOccurrence } from "./occurrence-model.js";

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

export interface RustNativeTypeRow {
  readonly id: number;
  readonly value: RustNativeType;
}

export interface RustNativeConstantRow {
  readonly id: number;
  readonly value: RustNativeConstant;
}

export interface RustNativeDefinition {
  readonly id: RustNativeDefinitionId;
  readonly parent: RustNativeDefinitionId | null;
  readonly path: string;
  readonly name: string | null;
  readonly kind: string;
  readonly macroKinds: readonly ("function-like" | "attribute" | "derive")[];
  readonly type: number | null;
  readonly generics: RustNativeGenerics | null;
  readonly visibility: RustNativeVisibility | null;
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

interface RustNativeDeclarationGraph {
  readonly inputs: readonly RustNativeSourceInput[];
  readonly probes: readonly RustNativeSourceProbe[];
  readonly types: readonly RustNativeTypeRow[];
  readonly constants: readonly RustNativeConstantRow[];
  readonly expansions: readonly RustNativeExpansion[];
  readonly definitions: readonly RustNativeDefinition[];
  readonly scopes: readonly RustNativeScope[];
}

export interface RustNativeDeclarationEvidence extends RustNativeDeclarationGraph {
  readonly phase: "declarations";
}

export interface RustNativeEvidence extends RustNativeDeclarationGraph {
  readonly phase: "checked";
  readonly occurrences: readonly RustNativeOccurrence[];
  readonly effects: readonly RustNativeBodyEffects[];
}

export type RustNativeSemanticEvidence = RustNativeDeclarationEvidence | RustNativeEvidence;

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

export interface RustNativeSourceProbe {
  readonly path: string;
  readonly exists: boolean;
}

export function nativeDefinitionKey(identity: RustNativeDefinitionId): string {
  return `${identity.krate}:${identity.index}`;
}

export function nativeNodeKey(identity: RustNativeNodeId): string {
  return `${nativeDefinitionKey(identity.owner)}:${identity.local}`;
}
