import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageFacadePlan } from "../../../target-model/records/program/source-packages.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function materializeRustSourcePackageFacades(input: RustPlanningContext): RustSourcePackageFacadePlan {
  const selected = input.program.records.sourcePackageFacades.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted source-package graph requires its sealed facade paths.");
  return selected;
}
