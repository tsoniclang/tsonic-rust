import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { RustProgramErrorOwner } from "../../../target-model/types/model.js";
import type { RustSourcePackageErrorBoundary, RustSourcePackageErrorPlan } from "../../../target-model/records/error-regions.js";

export type RustProgramErrorRoute =
  | {
      readonly kind: "local";
      readonly variant: string;
    }
  | {
      readonly kind: "external";
      readonly consumerVariant: string;
      readonly ownerTypePath: string;
      readonly ownerVariant: string;
    };

export function resolveRustSourcePackageErrorBoundary(
  plan: RustSourcePackageErrorPlan,
  consumerComponentId: string,
  ownerComponentId: string,
): RustSourcePackageErrorBoundary | undefined {
  return plan.componentBoundaryFor(consumerComponentId, ownerComponentId);
}

export function resolveRustPhysicalProgramErrorBoundary(
  plan: RustSourcePackageErrorPlan,
  consumerComponentId: string,
  owner: RustProgramErrorOwner,
): RustSourcePackageErrorBoundary | undefined {
  return plan.physicalBoundaryFor(consumerComponentId, owner);
}

export function resolveRustProgramErrorRoute(
  plan: RustSourcePackageErrorPlan,
  componentId: string,
  definition: RustProjectTypeDefinition,
  ownerVariant: string,
): RustProgramErrorRoute | undefined {
  const ownerComponentId = plan.componentIdByDefinition.get(definition);
  if (ownerComponentId === undefined) {
    return undefined;
  }
  const consumerDomain = plan.domainsByComponentId.get(componentId);
  if (ownerComponentId === componentId || consumerDomain?.errorOwnerComponentId === ownerComponentId) {
    return Object.freeze({ kind: "local", variant: ownerVariant });
  }
  const external = consumerDomain?.externalErrors.find((candidate) =>
    candidate.errorOwnerComponentId === ownerComponentId);
  return external === undefined
    ? undefined
    : Object.freeze({
        kind: "external",
        consumerVariant: external.variant,
        ownerTypePath: external.typePath,
        ownerVariant,
      });
}
