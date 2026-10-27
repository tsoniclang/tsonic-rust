import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../../../target-model/names/source-output-identities.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { planRustSourceFile, type PlannedRustSourceFile } from "../program/source-file.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export interface RustSourceFilePlan {
  readonly sourcesByComponentId: ReadonlyMap<string, readonly PlannedRustSourceFile[]>;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
}

export function planRustSourceFiles(input: RustPlanningContext,
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  workerEntryIdentityByFileName: ReadonlyMap<string, string>,
  components: readonly RustSourcePackageComponentPlan[],
  errors: RustSourcePackageErrorPlan,
  diagnostics: TargetDiagnostic[]): RustSourceFilePlan {
  const files = input.program.records.sourceArtifacts.get();
  const externalItems = input.program.records.externalSourceItems.get();
  if (files === undefined || externalItems === undefined)
    failRustPlannerInvariant("An admitted program requires its complete source artifact and native linkage inventory.");
  const byComponent = new Map(components.map(component => [component.componentId, [] as PlannedRustSourceFile[]]));
  const componentById = new Map(components.map(component => [component.componentId, component]));
  const moduleNames = new Map([...identities].map(([fileName, identity]) => [fileName, identity.moduleName]));
  const crateNames = new Map([...identities].flatMap(([fileName, identity]) =>
    identity.externalCrateName === undefined ? [] : [[fileName, identity.externalCrateName] as const]));
  for (const { sourceFile } of files) {
    const identity = identities.get(input.program.source.ast.getFileName(sourceFile));
    const component = identity === undefined ? undefined : componentById.get(identity.componentId);
    if (identity === undefined || component === undefined)
      failRustPlannerInvariant("An admitted source artifact requires its exact native component and module identity.", sourceFile);
    byComponent.get(component.componentId)!.push(planRustSourceFile(sourceFile, identity.moduleName,
      component.componentId, component.crateName, moduleNames, crateNames, externalItems,
      externalStructuralShapeModuleByFileName, workerEntryIdentityByFileName,
      component.programModuleName, component.structuralShapesModuleName, identity.childModuleNames,
      component.publicModuleNames, component.publicImplementationModuleNames,
      component.publicImplementationItemIdentities, component.publishesImplementationAbi,
      component.errorDomain, errors, input, diagnostics));
  }
  return Object.freeze({ sourcesByComponentId: new Map([...byComponent].map(([key, values]) =>
    [key, Object.freeze(values)])), externalItemPathByIdentity: externalItems });
}
