import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustSourceGenericContract } from "../lifetimes/model.js";
import type { RustTypeAliasDeclarationFact } from "./callables-and-resources.js";
import type { RustSourceUnionPayloadTemplate } from "../types/source-union-definitions.js";
import type { RustConditionalSourceTypeFamily } from "../types/type-families.js";

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
}

export interface RustNativeInterfaceDeclaration {
  readonly kind: "interface";
  readonly name: string;
  readonly definition: RustProjectTypeDefinition;
  readonly fields: readonly RustNativeInterfaceField[];
  readonly index?: {
    readonly declaration: Node;
    readonly targetName: string;
    readonly keyCarrier: TargetTypeRef;
    readonly valueCarrier: TargetTypeRef;
  };
}

export interface RustNativeAliasDeclaration {
  readonly kind: "alias";
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly fact: RustTypeAliasDeclarationFact;
  readonly genericContract?: RustSourceGenericContract;
  readonly payloadTemplate?: RustSourceUnionPayloadTemplate;
  readonly family?: RustConditionalSourceTypeFamily;
}
