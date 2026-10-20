import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustSourcePackageErrorBoundary, RustSourcePackageErrorDomainPlan } from "../../../target-model/records/source-package-errors.js";
import type { RustPlannedErrorVariant, RustBoundaryErrorVariants } from "../../../target-model/records/error-transport.js";

export function planRustBoundaryErrorVariants(
  program: { readonly records: Pick<RustProgramRecords, "boundaryErrorVariants"> },
  boundary: RustSourcePackageErrorBoundary,
): RustBoundaryErrorVariants | undefined {
  return program.records.boundaryErrorVariants.get(boundary.componentId, boundary.errorTypeIdentity);
}

export function planRustErrorVariants(
  program: { readonly records: Pick<RustProgramRecords, "programErrorVariants"> },
  domain: RustSourcePackageErrorDomainPlan,
): readonly RustPlannedErrorVariant[] | undefined {
  return program.records.programErrorVariants.get(domain.componentId);
}
