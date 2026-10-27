import type { AstReader, Node, Symbol, TypeSignatureInfo, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustSourceTypeFamilyRegistry } from "../../types/type-families.js";
import type { RustTypeDefinitions } from "../../types/source-union-definitions.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

export interface RustSourceEnumVariant {
  readonly name: string;
  readonly literal: string;
}

export interface RustSourceObjectField {
  readonly declarations: readonly Node[];
  readonly symbols: readonly Symbol[];
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
  readonly sourceAlias?: Node;
  readonly carrier: TargetTypeRef;
  readonly storage: "project-object" | "structural-object";
  readonly fields: readonly RustSourceObjectField[];
  readonly construction?: {
    readonly declaration: Node;
    readonly signatureInfo: TypeSignatureInfo;
    readonly carrier: TargetTypeRef;
  };
}

export interface RustSourceUnionVariant {
  readonly name: string;
  readonly sourceTypes: readonly Type[];
  readonly carrier: TargetTypeRef;
  readonly shape?: RustSourceObjectShape;
}

export interface RustSourceUnion {
  readonly declaration?: Node;
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
  readonly kind: "stored" | "accessor" | "dispatch";
}

export interface RustStructuralInstantiation {
  readonly template: TargetTypeRef;
  readonly instance: TargetTypeRef;
}

export interface RustSourceTypeQueries extends RustTypeDefinitions {
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  carrierForDeclaration(declaration: Node): TargetTypeRef | undefined;
  declarationForCarrier(carrier: TargetTypeRef): Node | undefined;
  propertyKeysForCarrier(carrier: TargetTypeRef, ast: AstReader, semanticsFor: (node: Node) => SourceFileSemantics): readonly string[] | undefined;
  enumVariantsForDeclaration(declaration: Node): readonly RustSourceEnumVariant[] | undefined;
  enumVariantForLiteral(carrier: TargetTypeRef, literal: string): RustSourceEnumVariant | undefined;
  structuralObjects(): readonly RustSourceObjectShape[];
  structuralObjectForCarrier(carrier: TargetTypeRef): RustSourceObjectShape | undefined;
  structuralFieldImplementations(): readonly RustStructuralFieldImplementation[];
  structuralInstantiations(): readonly RustStructuralInstantiation[];
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
  pendingSourceUnions(): readonly Node[];
  generatedSourceUnions(): readonly RustSourceUnion[];
  generatedUnionCarrierForVariants(carriers: readonly TargetTypeRef[]): TargetTypeRef | undefined;
  sourceUnionForCarrier(carrier: TargetTypeRef): RustSourceUnion | undefined;
  sourceUnionVariantIndexesForTypes(
    carrier: TargetTypeRef,
    types: readonly Type[],
  ): readonly number[] | undefined;
}
