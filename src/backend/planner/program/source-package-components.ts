import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/source-packages.js";
import type { RustSourcePackageErrorPlan } from "./source-package-errors.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../../invariants.js";

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
