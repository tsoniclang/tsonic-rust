import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustSourceGenericContract } from "../lifetimes/model.js";
import type { RustTypeAliasDeclarationFact } from "./callables-and-resources.js";
import type { RustSourceUnionPayloadTemplate } from "../types/source-union-definitions.js";
import type { RustSourceObjectPhysicalDefinition, RustSourceObjectPhysicalField } from "../types/source-union-definitions.js";
import type { RustCapturedFieldStorage } from "../types/field-storage.js";
import type { RustConditionalSourceTypeFamily } from "../types/type-families.js";
import type { RustNativeBindingStorage } from "./physical-emission-contexts.js";

export interface RustNativeEnumDeclaration {
  readonly kind: "enum";
  readonly name: string;
  readonly integerWidth: 32 | 64;
  readonly variants: readonly {
    readonly declaration: Node;
    readonly name: string;
    readonly discriminant: string;
  }[];
}

export interface RustNativeInterfaceField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly nativePayloadCarrier: TargetTypeRef;
  readonly nativeCarrier: TargetTypeRef;
  readonly nativeStorage: RustNativeBindingStorage;
}

export interface RustNativeInterfaceDeclaration {
  readonly kind: "interface";
  readonly name: string;
  readonly definition: RustProjectTypeDefinition;
  readonly nativeCarrier: TargetTypeRef;
  readonly nativeStateCarrier: TargetTypeRef;
  readonly fields: readonly RustNativeInterfaceField[];
  readonly physical: RustNativeObjectPhysicalDeclaration;
  readonly index?: {
    readonly declaration: Node;
    readonly targetName: string;
    readonly keyCarrier: TargetTypeRef;
    readonly valueCarrier: TargetTypeRef;
    readonly nativeKeyCarrier: TargetTypeRef;
    readonly nativeValueCarrier: TargetTypeRef;
  };
}

export interface RustNativeClassField extends RustNativeInterfaceField {
  readonly initializer: Node | undefined;
  readonly storage:
    | { readonly kind: "value" }
    | { readonly kind: "capture"; readonly selection: RustCapturedFieldStorage }
    | { readonly kind: "frame"; readonly declaration: Node };
}

export type RustNativeObjectPhysicalField = RustSourceObjectPhysicalField & {
  readonly copy: boolean;
} & (
  | { readonly kind: "field"; readonly declaration: Node }
  | { readonly kind: "frame"; readonly carrier: TargetTypeRef }
  | { readonly kind: "frame-counter" }
  | { readonly kind: "environment"; readonly carrier: TargetTypeRef }
  | { readonly kind: "method"; readonly declaration: Node }
  | { readonly kind: "index" }
  | { readonly kind: "marker" }
  | { readonly kind: "state" }
  | { readonly kind: "identity" }
  | { readonly kind: "dispatch" }
);

export interface RustNativeObjectPhysicalDeclaration {
  readonly definition: RustSourceObjectPhysicalDefinition;
  readonly storageFields: readonly RustNativeObjectPhysicalField[];
  readonly fields: readonly RustNativeObjectPhysicalField[];
  readonly clone:
    | { readonly kind: "unavailable" }
    | { readonly kind: "conditional"; readonly requirements: readonly TargetTypeRef[] };
}

export interface RustNativeClassDeclaration {
  readonly kind: "class";
  readonly name: string;
  readonly definition: RustProjectTypeDefinition;
  readonly fields: readonly RustNativeClassField[];
  readonly methodProperties: readonly { readonly declaration: Node; readonly targetName: string }[];
  readonly frameCounterName: string | undefined;
  readonly physical: RustNativeObjectPhysicalDeclaration;
}

export interface RustNativeAliasDeclaration {
  readonly kind: "alias";
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly nativeCarrier: TargetTypeRef | null;
  readonly fact: RustTypeAliasDeclarationFact;
  readonly genericContract?: RustSourceGenericContract;
  readonly payloadTemplate: RustSourceUnionPayloadTemplate | null;
  readonly family?: RustConditionalSourceTypeFamily;
}
