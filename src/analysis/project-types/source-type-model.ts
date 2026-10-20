import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustSourceTypeQueries, RustSourceObjectShape, RustStructuralFieldImplementation, RustSourceUnion } from "../../target-model/records/source-types.js";
export interface RustSourceTypeRegistry extends RustSourceTypeQueries {
  registerSourceFile(sourceFile: SourceFile, ast: AstReader, isNativeNode: (node: Node) => boolean): void;
  registerDeclarationCarrier(declaration: Node, carrier: TargetTypeRef): boolean;
  registerRepresentationAlias(declaration: Node, carrier: TargetTypeRef): boolean;
  registerStructuralObject(shape: RustSourceObjectShape, template?: TargetTypeRef): boolean;
  registerStructuralFieldImplementation(
    implementation: RustStructuralFieldImplementation,
  ): boolean;
  registerSourceUnion(union: RustSourceUnion): boolean;
  reserveSourceUnion(declaration: Node, carrier: TargetTypeRef): boolean;
}
