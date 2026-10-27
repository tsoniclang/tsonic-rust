import type { RustPlanningContext } from "../context.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustProgramErrorOwner } from "../../../target-model/types/model.js";
import type { RustSourcePackageErrorPlan, RustSourcePackageErrorBoundary } from "../../../target-model/records/errors/source-package-errors.js";
import type { RustSourcePackageErrorRoute } from "../../../target-model/records/errors/source-package-errors.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustSourcePackageErrors(input: RustPlanningContext): RustSourcePackageErrorPlan {
  const selected = input.program.records.sourcePackageErrors.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted source-package graph requires its exact native error domains.");
  return selected;
}

export function resolveRustSourcePackageErrorBoundary(
  records: Pick<RustProgramRecords, "sourcePackageErrorBoundary">,
  consumer: string,
  owner: string,
): RustSourcePackageErrorBoundary | undefined {
  return records.sourcePackageErrorBoundary.get(consumer, owner);
}

export function resolveRustPhysicalProgramErrorBoundary(
  records: Pick<RustProgramRecords, "physicalProgramErrorBoundary">,
  consumer: string,
  owner: RustProgramErrorOwner,
): RustSourcePackageErrorBoundary | undefined {
  return records.physicalProgramErrorBoundary.get(consumer, owner);
}

export function resolveRustProgramErrorRoute(
  records: Pick<RustProgramRecords, "programErrorRoute">,
  consumer: string,
  definition: RustProjectTypeDefinition,
  variant: string,
): RustSourcePackageErrorRoute | undefined {
  return records.programErrorRoute.get(consumer, definition, variant);
}
