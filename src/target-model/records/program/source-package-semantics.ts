import { type RustSourcePackageFacadeExportContract } from "./source-packages.js";
import { type TargetCompileInput } from "@tsonic/target-api";
import { type RustErrorDomain } from "../../operations/error-boundary.js";
import { type RustClosedErrorTransportDemand } from "../errors/closed-error-demand.js";

export interface RustSourcePackageFacadeClassifications {
  readonly rootComponentId: string;
  readonly componentIds: readonly string[];
  readonly rootExports: readonly RustSourcePackageFacadeExportContract[];
  exportsForComponent(
    componentId: string,
  ): readonly RustSourcePackageFacadeExportContract[];
  publicModuleNamesForComponent(componentId: string): readonly string[];
  publicImplementationItemIdentitiesForComponent(
    componentId: string,
  ): readonly string[];
}

export interface RustSourcePackageComponentSemantics {
  readonly componentId: string;
  readonly sourceFileNames: readonly string[];
  readonly dependencyComponentIds: readonly string[];
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly errorOwnerComponentId: string | undefined;
  readonly closedErrorDemand: RustClosedErrorTransportDemand;
  readonly root: boolean;
}

export interface RustSourcePackageComponentClassifications {
  readonly components: readonly RustSourcePackageComponentSemantics[];
  readonly rootComponentId: string;
  forComponent(componentId: string): RustSourcePackageComponentSemantics | undefined;
  componentForFile(fileName: string): RustSourcePackageComponentSemantics | undefined;
  canReferenceFile(fromFileName: string, targetFileName: string): boolean;
}

export interface RustSourcePackageComponentIdentities {
  readonly rootComponentId: string;
  readonly componentById: ReadonlyMap<string, TargetCompileInput["sourcePackages"]["components"][number]>;
  readonly sourceFileNamesByComponent: ReadonlyMap<string, ReadonlySet<string>>;
  readonly activeComponentIds: ReadonlySet<string>;
  readonly componentOrder: readonly string[];
  componentIdForFile(fileName: string): string | undefined;
}
