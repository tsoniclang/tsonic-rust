import type { SourceFile } from "@tsonic/tsts";
import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageInitializerPlan } from "../../../target-model/records/program/source-packages.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustSourcePackageInitializers(input: RustPlanningContext): RustSourcePackageInitializerPlan {
  const selected = input.program.records.sourcePackageInitializers.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted source graph requires its sealed native initializer identities.");
  return selected;
}

export function rustModuleInitializerFunctionName(input: RustPlanningContext, sourceFile: SourceFile): string {
  const selected = input.program.records.sourcePackageInitializers.get()?.functionNameByFileName.get(input.program.source.ast.getFileName(sourceFile));
  if (selected === undefined) failRustPlannerInvariant("An admitted native module initializer requires its sealed function name.", sourceFile);
  return selected;
}
