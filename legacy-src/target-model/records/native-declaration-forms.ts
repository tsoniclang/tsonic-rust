import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustSourceTypeFamilyImplementation } from "../types/type-families.js";
import type {
  RustNativeAliasDeclaration,
  RustNativeEnumDeclaration,
  RustNativeInterfaceDeclaration,
} from "./native-value-declarations.js";

export type RustNativeDeclarationForm =
  | RustNativeEnumDeclaration
  | RustNativeInterfaceDeclaration
  | RustNativeAliasDeclaration;

export interface RustNativeDeclarationForms {
  readonly implementations: readonly {
    readonly implementation: RustSourceTypeFamilyImplementation;
    readonly projectDefinition?: RustProjectTypeDefinition;
  }[];
  get(declaration: Node): RustNativeDeclarationForm | undefined;
}
