import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustSourceTypeFamilyImplementation } from "../types/type-families.js";
import type { TargetTypeRef } from "../types/model.js";
import type {
  RustNativeAliasDeclaration,
  RustNativeClassDeclaration,
  RustNativeEnumDeclaration,
  RustNativeInterfaceDeclaration,
} from "./native-value-declarations.js";

export type RustNativeDeclarationForm =
  | RustNativeClassDeclaration
  | RustNativeEnumDeclaration
  | RustNativeInterfaceDeclaration
  | RustNativeAliasDeclaration;

export interface RustNativeDeclarationForms {
  readonly implementations: readonly {
    readonly implementation: RustSourceTypeFamilyImplementation;
    readonly projectDefinition?: RustProjectTypeDefinition;
    readonly nativeTypes: {
      readonly owner: TargetTypeRef;
      readonly trait: TargetTypeRef;
      readonly output: TargetTypeRef;
    } | null;
  }[];
  get(declaration: Node): RustNativeDeclarationForm | undefined;
}
