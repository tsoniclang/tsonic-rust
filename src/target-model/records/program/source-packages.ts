import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustErrorRegionSelection } from "../errors/error-regions.js";
export interface RustSourcePackageModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly componentId: string;
  readonly crateName?: string;
  readonly implementationModuleName: string;
  readonly implementationFunctionName: string;
  readonly facadeModuleName: string;
  readonly facadeFunctionName: string;
  readonly asynchronous: boolean;
  readonly errorRegion: RustErrorRegionSelection;
}

export interface RustSourcePackageInitializerPlan {
  readonly functionNameByFileName: ReadonlyMap<string, string>;
  readonly byFileName: ReadonlyMap<string, RustSourcePackageModuleInitializer>;
  readonly facadeModuleNameByComponent: ReadonlyMap<string, string>;
}
import type { RustErrorDomain } from "../../operations/error-boundary.js";
import type { RustSourcePackageErrorRecords } from "../errors/source-package-errors.js";
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
  readonly packageCargo: import("./source-package-crates.js").RustPackageCargoRecords["packageCargo"];
  readonly signatureVisibility: import("../types/signature-visibility.js").RustSignatureVisibilityRecords["signatureVisibility"];
  readonly programEmission: import("./program-emission.js").RustProgramEmissionRecords["programEmission"];
  readonly workerEntries: { readonly get: () => readonly RustWorkerEntryEmission[] | undefined };
  readonly sourcePackageInitializers: { readonly get: () => RustSourcePackageInitializerPlan | undefined };
  readonly sourcePackageComponents: { readonly get: () => readonly RustSourcePackageComponentPlan[] | undefined };
  readonly sourcePackageFacades: { readonly get: () => RustSourcePackageFacadePlan | undefined };
}

export interface RustWorkerEntryEmission {
  readonly sourceIdentity: import("../../names/source-output-identities.js").RustSourceFileOutputIdentity;
  readonly sourceFile: import("@tsonic/tsts").SourceFile;
  readonly fileName: string;
  readonly identity: string;
  readonly componentId: string;
  readonly initializer: import("../errors/error-regions.js").RustInitializerSelection;
}
