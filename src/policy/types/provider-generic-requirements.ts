import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustProviderTypeParameterRequirement,
  RustProviderTypeRequirement,
} from "../../target-model/operations/model.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsTrait,
  rustCarrierSupportsClone,
  rustFutureTargetId,
} from "../../target-model/types/index.js";

export function rustProviderGenericRequirementsAreSatisfied(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: ReadonlyMap<string, TargetTypeRef>,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier))) {
      return false;
    }
  }
  return true;
}

export function rustProviderOperationGenericRequirementsAreSelectable(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: ReadonlyMap<string, TargetTypeRef>,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier) &&
      !rustAnonymousFutureRequirementIsRustcDecidable(requirement, carrier))) {
      return false;
    }
  }
  return true;
}

function rustProviderTypeRequirementIsSatisfied(
  requirement: RustProviderTypeRequirement,
  carrier: TargetTypeRef,
): boolean {
  if (requirement === "copy") return isRustCopyCarrier(carrier);
  if (requirement === "clone") return rustCarrierSupportsClone(carrier);
  return rustCarrierSupportsTrait(carrier, requirement.path);
}

const rustcDecidableFutureAutoTraits: ReadonlySet<string> = new Set([
  "core::marker::Send",
  "core::marker::Sync",
  "core::marker::Unpin",
]);

function rustAnonymousFutureRequirementIsRustcDecidable(
  requirement: RustProviderTypeRequirement,
  carrier: TargetTypeRef,
): boolean {
  return carrier.kind === "target-named" && carrier.id === rustFutureTargetId &&
    typeof requirement === "object" &&
    rustcDecidableFutureAutoTraits.has(requirement.path);
}
