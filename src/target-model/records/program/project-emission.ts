import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition, RustProjectMemberSlotRole } from "../../types/project-types.js";
import type { RustLifetimeRef, RustSourceGenericParameterContract } from "../../lifetimes/model.js";
import type { RustObjectRepresentation } from "../objects/object-representation.js";
import type { RustGenericRequirement, RustAssociatedTypeRequirement, RustOptionalStorageRequirement } from "../types/generic-requirements.js";
import type { RustShapeGenericRequirementContract } from "../types/generic-requirements.js";
import type { RustProjectProjectionRequirement } from "../../types/project-projections.js";
import type { RustStructuralShapeDefinition } from "../objects/structural-shapes.js";
import type { RustGeneratedUnionDefinition } from "../types/generated-unions.js";
import type { RustProjectProjectionImplementation } from "../objects/project-projections.js";

export interface RustProjectGenericEmission {
  readonly parameters: readonly { readonly parameter: RustSourceGenericParameterContract; readonly requirements: readonly RustGenericRequirement[] }[];
  readonly outlives: readonly RustLifetimeRef[];
  readonly optionalStorage: readonly RustOptionalStorageRequirement[];
  readonly associated: readonly RustAssociatedTypeRequirement[];
  readonly projections: readonly RustProjectProjectionRequirement[];
  readonly markerName: string;
}

export interface RustProjectEmissionRecords {
  readonly optionalStorageTypeArguments: { readonly get: (carrier: TargetTypeRef, indexes?: readonly number[]) => readonly TargetTypeRef[] | undefined };
  readonly optionalStorageCallArguments: { readonly get: (node: Node) => readonly TargetTypeRef[] | undefined };
  readonly sourceTypeIdentity: { readonly get: (fileName: string, typeName: string) => { readonly targetName: string; readonly native: boolean } | undefined };
  readonly projectError: { readonly get: (definition: RustProjectTypeDefinition) => RustProjectErrorEmission | undefined };
  readonly projectMemberSlot: { readonly get: (declaration: Node, role: RustProjectMemberSlotRole) => string | undefined };
  readonly projectProjectionImplementations: { readonly get: (definition: RustProjectTypeDefinition) => readonly RustProjectProjectionImplementation[] | undefined };
  readonly projectStateConstruction: { readonly get: (definition: RustProjectTypeDefinition) => { readonly baseName: string; readonly visibility: "public" | "crate" } | undefined };
  readonly checkedProjectProjection: { readonly get: (carrier: TargetTypeRef) => RustCheckedProjectProjectionEmission | undefined };
  readonly structuralShape: { readonly get: (carrier: TargetTypeRef | undefined) => RustStructuralShapeDefinition | undefined };
  readonly structuralDeclarations: { readonly get: (component: string) => readonly RustStructuralShapeDefinition[] | undefined };
  readonly sourceUnion: { readonly get: (carrier: TargetTypeRef) => RustGeneratedUnionDefinition | undefined };
  readonly sourceUnionDeclarations: { readonly get: (component: string) => readonly RustGeneratedUnionDefinition[] | undefined };
  readonly structuralGenerics: { readonly get: (carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined };
  readonly projectType: { readonly get: (carrier: TargetTypeRef | undefined) => RustProjectTypeDefinition | undefined };
  readonly projectDeclaration: { readonly get: (declaration: Node | undefined) => RustProjectTypeDefinition | undefined };
  readonly projectMemberOwner: { readonly get: (declaration: Node | undefined) => RustProjectTypeDefinition | undefined };
  readonly objectRepresentation: { readonly get: (definition: RustProjectTypeDefinition | undefined) => RustObjectRepresentation | undefined };
  readonly projectGenerics: { readonly get: (definition: RustProjectTypeDefinition, indexes?: readonly number[], outlives?: readonly RustLifetimeRef[], body?: true) => RustProjectGenericEmission | undefined };
}

export type RustCheckedProjectProjectionEmission = { readonly kind: "structural" | "project" | "excluded" };

export interface RustProjectErrorEmission {
  readonly sourceError: boolean;
  readonly variant: string | undefined;
  readonly carrier: TargetTypeRef;
  readonly superTrait: boolean;
  readonly inherited: boolean;
  readonly fields: readonly { readonly name: "name" | "message" | "stack"; readonly declaration: Node; readonly read: string | undefined; readonly write: string | undefined }[];
}
