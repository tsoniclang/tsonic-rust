import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type {
  RustProviderTypeParameterRequirement,
  RustProviderTypeRequirement,
} from "../../target-model/operations/model.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustCarrierSatisfiesTraitRef,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import type {
  RustTargetGenericBindings,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustProviderGenericRequirementsAreSatisfied(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: RustTargetGenericBindings,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.types.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier, bindings, definitions))) {
      return false;
    }
  }
  return true;
}

export function rustProviderOperationGenericRequirementsAreSelectable(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: RustTargetGenericBindings,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.types.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      !rustProviderTypeRequirementIsSatisfied(requirement, carrier, bindings, definitions) &&
      !rustProviderOperationRequirementIsRustcDecidable(requirement, bindings))) {
      return false;
    }
  }
  return true;
}

function rustProviderOperationRequirementIsRustcDecidable(
  requirement: RustProviderTypeRequirement,
  bindings: RustTargetGenericBindings,
): boolean {
  if (typeof requirement !== "object") return false;
  return substituteProviderTraitRequirement(requirement, bindings) !== undefined;
}

function rustProviderTypeRequirementIsSatisfied(
  requirement: RustProviderTypeRequirement,
  carrier: TargetTypeRef,
  bindings: RustTargetGenericBindings,
  definitions: RustTypeDefinitions,
): boolean {
  if (requirement === "copy") return isRustCopyCarrier(carrier);
  if (requirement === "clone") return rustCarrierSupportsClone(carrier, definitions);
  const trait = substituteProviderTraitRequirement(requirement, bindings);
  return trait !== undefined && rustCarrierSatisfiesTraitRef(carrier, trait, undefined, definitions);
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
