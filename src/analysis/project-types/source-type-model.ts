import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustSourceTypeQueries, RustSourceObjectShape, RustStructuralFieldImplementation, RustSourceUnion } from "../../target-model/records/types/source-types.js";
export type RustStructuralObjectRegistration =
  | { readonly kind: "root" }
  | { readonly kind: "generic-instantiation"; readonly template: TargetTypeRef };

export interface RustSourceTypeRegistry extends RustSourceTypeQueries {
  registerSourceFile(sourceFile: SourceFile, ast: AstReader, isNativeNode: (node: Node) => boolean): void;
  registerDeclarationCarrier(declaration: Node, carrier: TargetTypeRef): boolean;
  registerRepresentationAlias(declaration: Node, carrier: TargetTypeRef): boolean;
  registerStructuralObject(shape: RustSourceObjectShape, registration: RustStructuralObjectRegistration): boolean;
  registerStructuralFieldImplementation(
    implementation: RustStructuralFieldImplementation,
  ): boolean;
  registerSourceUnion(union: RustSourceUnion): boolean;
  reserveSourceUnion(declaration: Node, carrier: TargetTypeRef): boolean;
}
