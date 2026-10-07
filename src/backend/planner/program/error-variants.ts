import type { RustTargetProgram } from "../../../analysis/program/model.js";
import type { RustErrorPayloadVariant } from "../../../analysis/program/error-transport.js";
import type { RustExternalSourcePackageError, RustSourcePackageErrorDomainPlan } from "./source-package-errors.js";

export type RustPlannedErrorVariant = RustErrorPayloadVariant
  | { readonly kind: "external"; readonly name: string; readonly external: RustExternalSourcePackageError };

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
