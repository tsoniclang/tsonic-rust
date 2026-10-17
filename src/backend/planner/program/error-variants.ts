import type { RustTargetProgram } from "../../../analysis/program/model.js";
import type { RustErrorPayloadVariant } from "../../../analysis/program/error-transport.js";
import type { RustExternalSourcePackageError, RustSourcePackageErrorDomainPlan, RustSourcePackageErrorPlan } from "../../../target-model/records/error-regions.js";
import type { RustSourcePackageErrorBoundary } from "../../../target-model/records/error-regions.js";

export type RustPlannedErrorVariant = RustErrorPayloadVariant
  | { readonly kind: "external"; readonly name: string; readonly external: RustExternalSourcePackageError };

export function planRustBoundaryErrorVariants(
  program: RustTargetProgram,
  errors: RustSourcePackageErrorPlan,
  boundary: RustSourcePackageErrorBoundary,
): { readonly domain: RustSourcePackageErrorDomainPlan; readonly variants: readonly RustPlannedErrorVariant[] } | undefined {
  const selected = errors.domainsByComponentId.get(boundary.componentId);
  const domain = selected?.forwardModulePath === undefined ? selected
    : selected.errorOwnerComponentId === undefined ? undefined : errors.domainsByComponentId.get(selected.errorOwnerComponentId);
  const variants = domain === undefined ? undefined : planRustErrorVariants(program, domain);
  return domain === undefined || variants === undefined || selected?.errorTypeIdentity !== boundary.errorTypeIdentity ||
    domain.errorTypeIdentity !== boundary.errorTypeIdentity ? undefined : Object.freeze({ domain, variants });
}

export function planRustErrorVariants(
  program: RustTargetProgram, domain: RustSourcePackageErrorDomainPlan,
): readonly RustPlannedErrorVariant[] | undefined {
  if (domain.errorDomain !== "project" || domain.errorOwnerComponentId !== domain.componentId ||
    domain.forwardModulePath !== undefined) return undefined;
  const inventory = program.errorTransport?.forComponent(domain.componentId);
  if (inventory === undefined) return undefined;
  const project = inventory.filter(variant => variant.kind === "project");
  if (project.length !== domain.definitions.length ||
    project.some((variant, index) => variant.definition !== domain.definitions[index])) return undefined;
  const variants: RustPlannedErrorVariant[] = [...project,
    ...domain.externalErrors.map(external => Object.freeze({ kind: "external" as const, name: external.variant, external })),
    ...inventory.filter(variant => variant.kind !== "project")];
  if (new Set(variants.map(variant => variant.name)).size !== variants.length ||
    variants.some(variant => variant.name === "Runtime" || variant.name === "SourceCreated" ||
      variant.name === "Suppressed")) return undefined;
  return Object.freeze(variants);
}
