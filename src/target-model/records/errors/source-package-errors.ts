import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustErrorDomain } from "../../operations/error-boundary.js";
import type { RustProgramErrorOwner } from "../../types/model.js";

export interface RustExternalSourcePackageError {
  readonly componentId: string;
  readonly errorOwnerComponentId: string;
  readonly crateName: string;
  readonly typePath: string;
  readonly transportTypePath: string;
  readonly sourceErrorTypePath: string;
  readonly writableSourceErrorTypePath: string;
  readonly variant: string;
}

export interface RustSourcePackageErrorDomainPlan {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorTypeIdentity: string;
  readonly errorOwnerComponentId: string | undefined;
  readonly forwardModulePath?: string;
  readonly definitions: readonly RustProjectTypeDefinition[];
  readonly externalErrors: readonly RustExternalSourcePackageError[];
}

export interface RustSourcePackageErrorPlan {
  readonly componentIdByFileName: ReadonlyMap<string, string>;
  readonly componentIdByDefinition: ReadonlyMap<RustProjectTypeDefinition, string>;
  readonly domainsByComponentId: ReadonlyMap<string, RustSourcePackageErrorDomainPlan>;
  readonly dependencyErrorsByComponentId: ReadonlyMap<string, readonly RustExternalSourcePackageError[]>;
}

export interface RustSourcePackageErrorBoundary {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorTypePath: string;
  readonly errorTypeIdentity: string;
}

export type RustSourcePackageErrorRoute =
  | {
      readonly kind: "local";
      readonly variant: string;
    }
  | {
      readonly kind: "external";
      readonly consumerVariant: string;
      readonly ownerTypePath: string;
      readonly ownerTransportTypePath: string;
      readonly sourceErrorTypePath: string;
      readonly writableSourceErrorTypePath: string;
      readonly ownerVariant: string;
    };

export interface RustSourcePackageErrorRecords {
  readonly sourcePackageErrors: { readonly get: () => RustSourcePackageErrorPlan | undefined };
  readonly sourcePackageErrorBoundary: { readonly get: (consumer: string, owner: string) => RustSourcePackageErrorBoundary | undefined };
  readonly physicalProgramErrorBoundary: { readonly get: (consumer: string, owner: RustProgramErrorOwner) => RustSourcePackageErrorBoundary | undefined };
  readonly programErrorRoute: { readonly get: (consumer: string, definition: RustProjectTypeDefinition, variant: string) => RustSourcePackageErrorRoute | undefined };
}
