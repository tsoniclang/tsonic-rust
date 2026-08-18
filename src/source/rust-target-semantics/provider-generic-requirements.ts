import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProviderTypeParameterRequirement,
} from "../provider-packages/index.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsTrait,
  rustCarrierSupportsClone,
} from "../rust-target-types.js";

export function rustProviderGenericRequirementsAreSatisfied(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: ReadonlyMap<string, TargetTypeRef>,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) => {
      if (requirement === "copy") {
        return !isRustCopyCarrier(carrier);
      }
      if (requirement === "clone") {
        return !rustCarrierSupportsClone(carrier);
      }
      return !rustCarrierSupportsTrait(carrier, requirement.path);
    })) {
      return false;
    }
  }
  return true;
}
