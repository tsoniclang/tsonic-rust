import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustLifetimeRef, RustSourceGenericParameterContract } from "../lifetimes/model.js";
import type { RustObjectRepresentation } from "./object-representation.js";
import type { RustGenericRequirement, RustAssociatedTypeRequirement, RustOptionalStorageRequirement } from "./generic-requirements.js";
import type { RustProjectProjectionRequirement } from "../types/project-projections.js";

export interface RustProjectGenericEmission {
  readonly parameters: readonly { readonly parameter: RustSourceGenericParameterContract; readonly requirements: readonly RustGenericRequirement[] }[];
  readonly outlives: readonly RustLifetimeRef[];
  readonly optionalStorage: readonly RustOptionalStorageRequirement[];
  readonly associated: readonly RustAssociatedTypeRequirement[];
  readonly projections: readonly RustProjectProjectionRequirement[];
  readonly markerName: string;
}

export interface RustProjectEmissionRecords {
  readonly projectType: { readonly get: (carrier: TargetTypeRef | undefined) => RustProjectTypeDefinition | undefined };
  readonly projectDeclaration: { readonly get: (declaration: Node | undefined) => RustProjectTypeDefinition | undefined };
  readonly projectMemberOwner: { readonly get: (declaration: Node | undefined) => RustProjectTypeDefinition | undefined };
  readonly objectRepresentation: { readonly get: (definition: RustProjectTypeDefinition | undefined) => RustObjectRepresentation | undefined };
  readonly projectGenerics: { readonly get: (definition: RustProjectTypeDefinition, indexes?: readonly number[], outlives?: readonly RustLifetimeRef[], body?: true) => RustProjectGenericEmission | undefined };
}
