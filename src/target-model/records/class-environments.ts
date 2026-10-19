import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustNamedClassEnvironment } from "./class-values.js";

export interface RustClassEnvironmentTypeEmission {
  readonly definition: RustProjectTypeDefinition;
  readonly environment: RustNamedClassEnvironment;
}

export interface RustClassEnvironmentRecords {
  readonly classEnvironment: { readonly get: (declaration: Node) => RustClassEnvironmentTypeEmission | undefined };
  readonly classEnvironmentType: { readonly get: (carrier: TargetTypeRef) => RustClassEnvironmentTypeEmission | undefined };
}
