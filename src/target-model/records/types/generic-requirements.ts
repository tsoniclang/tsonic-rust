import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustOptionalStorageProjection } from "../../types/projections.js";
import type { RustProjectProjectionRequirement } from "../../types/project-projections.js";

export type RustGenericRequirement = "clone" | "default" | "static" | "source-numeric" | "number-predicate" | "js-rejection";

export interface RustDeclarationTypeParameterRequirements {
  readonly identity: string;
  readonly name: string;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustAssociatedTypeRequirement {
  readonly carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>;
  readonly requirements: readonly RustGenericRequirement[];
  readonly fieldAccess?: readonly ("read" | "write")[];
  readonly output?: TargetTypeRef;
}

export interface RustOptionalStorageRequirement {
  readonly carrier: RustOptionalStorageProjection;
  readonly captured: boolean;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustDeclarationGenericRequirementContract {
  readonly uses: readonly {
    readonly node: Node;
    readonly carrier: TargetTypeRef;
    readonly requirements: readonly RustGenericRequirement[];
    readonly nativeStorageCarrier?: TargetTypeRef;
  }[];
  readonly declaration: Node;
  readonly typeParameters: readonly RustDeclarationTypeParameterRequirements[];
  readonly capturedTypeParameters: readonly RustDeclarationTypeParameterRequirements[];
  readonly nativeInputs: readonly RustDeclarationTypeParameterRequirements[];
  readonly associatedTypes: readonly RustAssociatedTypeRequirement[];
  readonly projectProjections: readonly RustProjectProjectionRequirement[];
  readonly optionalStorage: readonly RustOptionalStorageRequirement[];
}

export type RustShapeGenericRequirementContract = Pick<RustDeclarationGenericRequirementContract, "typeParameters" | "associatedTypes">;
