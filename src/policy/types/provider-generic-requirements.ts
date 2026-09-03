import type {
  RustProviderTypeParameterRequirement,
  RustProviderTypeRequirement,
} from "../../target-model/operations/model.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustCarrierSatisfiesTraitRef,
  rustCarrierSupportsTrait,
  rustFutureTargetId,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import type {
  RustTargetGenericBindings,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustProviderGenericRequirementsAreSatisfied(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: RustTargetGenericBindings,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.types.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier, bindings))) {
      return false;
    }
  }
  return true;
}

export function rustProviderOperationGenericRequirementsAreSelectable(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: RustTargetGenericBindings,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.types.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier, bindings) &&
      !rustProviderOperationRequirementIsRustcDecidable(requirement, carrier, bindings))) {
      return false;
    }
  }
  return true;
}

function rustProviderOperationRequirementIsRustcDecidable(
  requirement: RustProviderTypeRequirement,
  carrier: TargetTypeRef,
  bindings: RustTargetGenericBindings,
): boolean {
  if (rustAnonymousFutureRequirementIsRustcDecidable(requirement, carrier)) {
    return true;
  }
  if (typeof requirement !== "object") return false;
  const trait = substituteProviderTraitRequirement(requirement, bindings);
  return trait !== undefined &&
    (trait.lifetimeBinder !== undefined || trait.associatedConstraints.length > 0) &&
    rustCarrierSupportsTrait(carrier, trait.path);
}

function rustProviderTypeRequirementIsSatisfied(
  requirement: RustProviderTypeRequirement,
  carrier: TargetTypeRef,
  bindings: RustTargetGenericBindings,
): boolean {
  if (requirement === "copy") return isRustCopyCarrier(carrier);
  if (requirement === "clone") return rustCarrierSupportsClone(carrier);
  const trait = substituteProviderTraitRequirement(requirement, bindings);
  return trait !== undefined && rustCarrierSatisfiesTraitRef(carrier, trait);
}

function substituteProviderTraitRequirement(
  requirement: Extract<RustProviderTypeRequirement, { readonly kind: "trait" }>,
  bindings: RustTargetGenericBindings,
) {
  const trait = substituteRustTargetGenerics(
    {
      kind: "trait-ref" as const,
      id: `provider-requirement:${requirement.path}`,
      path: requirement.path,
      genericArguments: requirement.genericArguments,
      associatedConstraints: requirement.associatedConstraints,
      ...(requirement.lifetimeBinder === undefined
        ? {}
        : { lifetimeBinder: requirement.lifetimeBinder }),
    },
    bindings.types,
    bindings.lifetimes,
    bindings.consts,
  );
  return trait.kind === "trait-ref" ? trait : undefined;
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
    requirement.genericArguments.length === 0 &&
    requirement.associatedConstraints.length === 0 &&
    requirement.lifetimeBinder === undefined &&
    rustcDecidableFutureAutoTraits.has(requirement.path);
}
