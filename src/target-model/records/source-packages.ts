import type { Node } from "@tsonic/tsts";

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

export interface RustSourcePackageEmissionRecords {
  readonly sourcePackageFacades: { readonly get: () => RustSourcePackageFacadePlan | undefined };
}
