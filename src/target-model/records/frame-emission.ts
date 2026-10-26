import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallableImplementation, RustFrameEntryErrorSelection } from "./frame-callables.js";
import type { RustGenericRequirement, RustAssociatedTypeRequirement } from "./generic-requirements.js";
import type { RustProjectProjectionRequirement } from "../types/project-projections.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustFrameCallableEntryDefinition } from "./frame-callables.js";
import type { RustObjectRepresentation } from "./object-representation.js";

export interface RustFrameNativeType {
  readonly definition: RustFrameCallableDefinition;
  readonly entry: RustFrameCallableEntryDefinition;
  readonly environment: readonly TargetTypeRef[];
  readonly owner: { readonly instance: TargetTypeRef; readonly representation: RustObjectRepresentation; readonly environment: boolean } | undefined;
}

export interface RustFrameTypeEmission extends RustFrameNativeType {
  readonly error: TargetTypeRef;
  readonly independentCarrier: TargetTypeRef | undefined;
}

export interface RustClassFrameFieldEmission {
  readonly binding: RustFrameCallableBinding;
  readonly frame: RustFrameCallableDefinition;
}

export interface RustFrameDefinitionEmission {
  readonly errors: ReadonlyMap<RustFrameCallableEntryDefinition, RustFrameEntryErrorSelection>;
  readonly counterName: string | undefined;
  readonly parameters: readonly { readonly identity: string; readonly name: string; readonly requirements: readonly RustGenericRequirement[] }[];
  readonly associated: readonly RustAssociatedTypeRequirement[];
  readonly projections: readonly RustProjectProjectionRequirement[];
  readonly payloads: ReadonlyMap<RustFrameCallableImplementation, boolean>;
}

export interface RustFrameEmissionRecords {
  readonly frameType: { readonly get: (carrier: TargetTypeRef) => RustFrameTypeEmission | undefined };
  readonly frameBindingDeclaration: { readonly get: (subject: Node) => RustFrameCallableBinding | undefined };
  readonly frameOwner: { readonly get: (subject: Node) => RustFrameCallableDefinition | undefined };
  readonly classFrameField: { readonly get: (subject: Node, carrier: TargetTypeRef) => RustClassFrameFieldEmission | undefined };
  readonly frameBinding: { readonly get: (subject: RustFrameCallableBinding) => RustFrameBindingEmission | undefined };
  readonly frameInput: { readonly get: (subject: Node) => ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission> | undefined };
  readonly frameReceiverOwner: { readonly get: (subject: Node) => Node | undefined };
  readonly frameImplementation: { readonly get: (subject: Node) => RustFrameCallableImplementation | undefined };
  readonly frameScopes: { readonly get: (subject: Node) => readonly RustFrameCallableDefinition[] | undefined };
  readonly frameDeclarations: { readonly get: (subject: SourceFile) => readonly RustFrameCallableDefinition[] | undefined };
  readonly frameDeclaration: { readonly get: (subject: RustFrameCallableDefinition) => RustFrameDefinitionEmission | undefined };
}

export interface RustFrameBindingEmission {
  readonly copy: boolean;
  readonly checkedWrite: boolean;
}

export interface RustFrameInputAdmission {
  readonly independent: boolean;
  readonly receiverOwner?: Node;
}
