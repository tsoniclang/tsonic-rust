import type { RustProviderTypeRequirement } from "./model.js";
import type { RustTargetTraitRef } from "../types/model.js";
import { rustNativeTraitRef } from "../types/carriers/native.js";

export function rustProviderTypeRequirementTrait(requirement: RustProviderTypeRequirement): RustTargetTraitRef {
  if (typeof requirement === "string") return rustNativeTraitRef(
    requirement === "clone" ? "core::clone::Clone" : "core::marker::Copy");
  return {
    kind: "trait-ref",
    id: `provider-requirement:${requirement.path}`,
    path: requirement.path,
    genericArguments: requirement.genericArguments,
    associatedConstraints: requirement.associatedConstraints,
    ...(requirement.lifetimeBinder === undefined ? {} : { lifetimeBinder: requirement.lifetimeBinder }),
  };
}
