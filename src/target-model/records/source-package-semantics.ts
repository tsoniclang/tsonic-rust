import type { RustSourcePackageFacadeExportContract } from "./source-packages.js";

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
