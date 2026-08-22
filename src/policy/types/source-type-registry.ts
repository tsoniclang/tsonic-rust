import type {
  AstReader,
  Node,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceMemberKey } from "../../target-model/types/source-member-keys.js";

export interface RustSourceEnumVariant {
  readonly name: string;
  readonly literal: string;
}

export interface RustSourceObjectField {
  readonly declarations: readonly Node[];
  readonly symbols: readonly Symbol[];
  readonly sourceKey: RustSourceMemberKey;
  readonly sourceName: string;
  readonly sourceType: Type;
  readonly storageIndex: number;
  readonly resultCarrier: TargetTypeRef;
  readonly presence: "required" | "optional";
  readonly readonly: boolean;
  readonly accessor?: {
    readonly getter: true;
    readonly setter: boolean;
  };
  readonly method?: true;
}

export interface RustSourceObjectShape {
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
  readonly storage: "project-object" | "object-handle";
  readonly fields: readonly RustSourceObjectField[];
}

export interface RustSourceUnionVariant {
  readonly name: string;
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
  readonly shape?: RustSourceObjectShape;
}

export interface RustSourceUnion {
  readonly declaration: Node;
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
  readonly variants: readonly RustSourceUnionVariant[];
  readonly selectedProperties: readonly {
    readonly symbol: Symbol;
    readonly declarations: readonly Node[];
  }[];
}

export interface RustStructuralFieldRegistration {
  readonly shape: RustSourceObjectShape;
  readonly field: RustSourceObjectField;
}

export interface RustStructuralFieldImplementation {
  readonly carrier: TargetTypeRef;
  readonly storageIndex: number;
  readonly kind: "stored" | "accessor";
}

export interface RustSourceTypeRegistry {
  registerSourceFile(sourceFile: SourceFile, ast: AstReader): void;
  registerDeclarationCarrier(declaration: Node, carrier: TargetTypeRef): boolean;
  registerRepresentationAlias(declaration: Node, carrier: TargetTypeRef): boolean;
  carrierForDeclaration(declaration: Node, ast: AstReader): TargetTypeRef | undefined;
  declarationForCarrier(carrier: TargetTypeRef): Node | undefined;
  propertyKeysForCarrier(carrier: TargetTypeRef, ast: AstReader): readonly string[] | undefined;
  enumVariantsForDeclaration(declaration: Node): readonly RustSourceEnumVariant[] | undefined;
  enumVariantForLiteral(carrier: TargetTypeRef, literal: string): RustSourceEnumVariant | undefined;
  registerStructuralObject(shape: RustSourceObjectShape): boolean;
  registerStructuralFieldImplementation(
    implementation: RustStructuralFieldImplementation,
  ): boolean;
  structuralObjects(): readonly RustSourceObjectShape[];
  structuralObjectForCarrier(carrier: TargetTypeRef): RustSourceObjectShape | undefined;
  structuralFieldImplementations(): readonly RustStructuralFieldImplementation[];
  structuralObjectForType(
    type: Type,
    carrier?: TargetTypeRef,
  ): RustSourceObjectShape | undefined;
  structuralFieldProjectionForSymbol(
    symbol: Symbol,
    receiverCarrier: TargetTypeRef,
  ): RustStructuralFieldRegistration | undefined;
  structuralFieldProjectionForDeclaration(
    declaration: Node,
    receiverCarrier: TargetTypeRef,
  ): RustStructuralFieldRegistration | undefined;
  declarationsForSelectedSymbol(symbol: Symbol): readonly Node[] | undefined;
  registerSourceUnion(union: RustSourceUnion): boolean;
  sourceUnionForCarrier(carrier: TargetTypeRef): RustSourceUnion | undefined;
  sourceUnionVariantIndexesForTypes(
    carrier: TargetTypeRef,
    types: readonly Type[],
  ): readonly number[] | undefined;
}
