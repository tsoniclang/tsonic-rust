import type { Node } from "@tsonic/tsts";
import type { RustErrorDomain } from "../operations/error-boundary.js";
import type { RustSourcePackageErrorRecords } from "./source-package-errors.js";
export interface RustSourcePackageComponentPlan {
  readonly componentId: string;
  readonly sourceFileNames: ReadonlySet<string>;
  readonly dependencyComponentIds: readonly string[];
  readonly crateName?: string;
  readonly programModuleName: string;
  readonly structuralShapesModuleName: string;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly errorOwnerComponentId: string | undefined;
  readonly root: boolean;
}

export interface RustSourcePackageFacadeExportContract {
  readonly packageId: string;
  readonly componentId: string;
  readonly sourceModuleFileName: string;
  readonly declaration: Node;
  readonly implementationFileName: string;
  readonly implementationName: string;
  readonly facadeModuleSegments: readonly string[];
  readonly facadeName: string;
}

export interface RustSourcePackageFacadeExport
  extends RustSourcePackageFacadeExportContract {
  readonly implementationModuleName: string;
}

export interface RustSourcePackageFacadePlan {
  readonly rootComponentId: string;
  readonly rootExports: readonly RustSourcePackageFacadeExport[];
  readonly exportsByComponentId: ReadonlyMap<
    string,
    readonly RustSourcePackageFacadeExport[]
  >;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly publicTopLevelModules: ReadonlySet<string>;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publicModuleNamesByComponent: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  readonly publicImplementationItemIdentitiesByComponent: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
}

export interface RustSourcePackageEmissionRecords extends RustSourcePackageErrorRecords {
  readonly sourcePackageComponents: { readonly get: () => readonly RustSourcePackageComponentPlan[] | undefined };
  readonly sourcePackageFacades: { readonly get: () => RustSourcePackageFacadePlan | undefined };
}
