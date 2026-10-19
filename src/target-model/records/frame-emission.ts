import type { SourceFile } from "@tsonic/tsts";
import type { RustFrameCallableDefinition, RustFrameCallableImplementation } from "./frame-callables.js";
import type { RustGenericRequirement, RustAssociatedTypeRequirement } from "./generic-requirements.js";
import type { RustProjectProjectionRequirement } from "../types/project-projections.js";

export interface RustFrameDefinitionEmission {
  readonly counterName: string | undefined;
  readonly parameters: readonly { readonly identity: string; readonly name: string; readonly requirements: readonly RustGenericRequirement[] }[];
  readonly associated: readonly RustAssociatedTypeRequirement[];
  readonly projections: readonly RustProjectProjectionRequirement[];
  readonly payloads: ReadonlyMap<RustFrameCallableImplementation, boolean>;
}

export interface RustFrameEmissionRecords {
  readonly frameDeclarations: { readonly get: (subject: SourceFile) => readonly RustFrameCallableDefinition[] | undefined };
  readonly frameDeclaration: { readonly get: (subject: RustFrameCallableDefinition) => RustFrameDefinitionEmission | undefined };
}
