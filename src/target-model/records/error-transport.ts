import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustValueConversion } from "../operations/model.js";
import type { RustExternalSourcePackageError, RustSourcePackageErrorDomainPlan } from "./source-package-errors.js";

export interface RustErrorPayloadAdmission {
  readonly target: TargetTypeRef;
  readonly conversion: RustValueConversion | null;
}

export type RustErrorPayloadVariant =
  | { readonly kind: "project"; readonly name: string; readonly definition: RustProjectTypeDefinition;
      readonly carrier: TargetTypeRef; readonly sourceError: boolean; readonly admissions: readonly RustErrorPayloadAdmission[] }
  | { readonly kind: "closed"; readonly name: string; readonly carrier: TargetTypeRef;
      readonly admissions: readonly RustErrorPayloadAdmission[] }
  | { readonly kind: "retained"; readonly name: "Retained" };

export interface RustErrorTransportQueries {
  readonly forComponent: (componentId: string) => readonly RustErrorPayloadVariant[] | undefined;
}

export type RustPlannedErrorVariant = RustErrorPayloadVariant
  | { readonly kind: "external"; readonly name: string; readonly external: RustExternalSourcePackageError };

export interface RustBoundaryErrorVariants {
  readonly domain: RustSourcePackageErrorDomainPlan;
  readonly variants: readonly RustPlannedErrorVariant[];
}

export interface RustErrorTransportEmissionRecords {
  readonly programErrorVariants: { readonly get: (componentId: string) => readonly RustPlannedErrorVariant[] | undefined };
  readonly boundaryErrorVariants: { readonly get: (componentId: string, identity: string) => RustBoundaryErrorVariants | undefined };
}
