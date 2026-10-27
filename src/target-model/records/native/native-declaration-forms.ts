import type { Node } from "@tsonic/tsts";
import type { RustShapeGenericRequirementContract } from "../types/generic-requirements.js";
import type { RustTargetGenericArgument } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustSourceTypeFamilyImplementation } from "../../types/type-families.js";
import type { RustNativeAliasDeclaration, RustNativeEnumDeclaration, RustNativeInterfaceDeclaration } from "./native-value-declarations.js";

export type RustNativeDeclarationForm =
  | RustNativeEnumDeclaration
  | RustNativeInterfaceDeclaration
  | RustNativeAliasDeclaration;

export interface RustNativeDeclarationForms {
  readonly implementations: readonly {
    readonly implementation: RustSourceTypeFamilyImplementation;
    readonly projectDefinition?: RustProjectTypeDefinition;
    readonly genericContract: RustShapeGenericRequirementContract;
    readonly storage: { readonly kind: "owner" } | {
      readonly kind: "structural-state";
      readonly ownerFileName: string;
      readonly targetName: string;
      readonly arguments: readonly RustTargetGenericArgument[];
    };
  }[];
  get(declaration: Node): RustNativeDeclarationForm | undefined;
}
