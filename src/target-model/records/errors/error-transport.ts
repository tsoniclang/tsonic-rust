import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustValueConversion } from "../../operations/model.js";
import type { RustExternalSourcePackageError, RustSourcePackageErrorDomainPlan } from "./source-package-errors.js";
import type { RustObjectRepresentation } from "../objects/object-representation.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";

export interface RustProgramErrorModuleEmission {
  readonly projects: readonly { readonly definition: RustProjectTypeDefinition; readonly name: string; readonly typePath: string;
    readonly representation: RustObjectRepresentation; readonly delegate: boolean }[];
  readonly providerErrors: readonly TargetTypeRef[];
  readonly closedPayloadPaths: ReadonlyMap<string, string>;
}

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
  readonly jsRejection: { readonly retained: string; readonly closed: string } | undefined;
}

export interface RustErrorTransportEmissionRecords {
  readonly programErrorClosedValue: { readonly get: (component: string, identity: string, target: TargetTypeRef) => RustClosedErrorValueSelection | undefined };
  readonly programErrorModule: { readonly get: (componentId: string) => RustProgramErrorModuleEmission | undefined };
  readonly programErrorVariants: { readonly get: (componentId: string) => readonly RustPlannedErrorVariant[] | undefined };
  readonly boundaryErrorVariants: { readonly get: (componentId: string, identity: string) => RustBoundaryErrorVariants | undefined };
}

export type RustClosedErrorPayloadEmission =
  | { readonly kind: "error" | "suppressed" }
  | { readonly kind: "value"; readonly conversion: RustValueConversionContract | null }
  | { readonly kind: "external"; readonly value: RustClosedErrorValueEmission };

export type RustClosedErrorValueEmission =
  | { readonly kind: "runtime" }
  | { readonly kind: "domain"; readonly path: string; readonly arms: readonly {
      readonly name: string; readonly payload: RustClosedErrorPayloadEmission;
    }[] };

export type RustClosedErrorValueSelection =
  | { readonly kind: "selected"; readonly ownerPath: "rt::TsValue" | "js_abi::JsValue"; readonly value: RustClosedErrorValueEmission }
  | { readonly kind: "rejected"; readonly reason: string };
