import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { qualifyRustReferencePath } from "../../target-ast/syntax/type-paths.js";
import { rustRuntimeAliasBindings } from "./plan-context.js";

export function createRustSourcePackageTypeRenderingContext(
  input: RustPlanningContext,
  component: RustSourcePackageComponentPlan,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  paths: Pick<RustTypeRenderingContext, "moduleNameByFileName" | "externalCrateNameByFileName" |
    "externalItemPathByIdentity" | "externalStructuralShapeModuleByFileName">,
): RustTypeRenderingContext & { readonly input: RustPlanningContext } {
  return {
    input, ...paths, sourcePackageErrors, sourcePackageComponentId: component.componentId,
    moduleName: component.programModuleName, structuralShapesModuleName: component.structuralShapesModuleName,
    ...(component.crateName === undefined ? {} : { crateName: component.crateName }),
  };
}

export function planRustSourcePackageComponents(input: RustPlanningContext): readonly RustSourcePackageComponentPlan[] {
  const selected = input.program.records.sourcePackageComponents.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted source-package graph requires its sealed native components.");
  return selected;
}

export function rustSourcePackageReferenceScope(
  context: RustTypeRenderingContext,
  referenceCrate: string,
): ReadonlyMap<string, string> {
  const component = context.input.program.records.sourcePackageComponents.get()
    ?.find(candidate => candidate.componentId === context.sourcePackageComponentId);
  if (component === undefined)
    return failRustPlannerInvariant("An admitted native reference requires its exact sealed source component.");
  const references = new Map([["crate", referenceCrate]]);
  for (const [alias, path] of rustRuntimeAliasBindings(component.errorDomain === "project" ? component.programModuleName : undefined))
    references.set(alias, qualifyRustReferencePath(path, references));
  return references;
}
