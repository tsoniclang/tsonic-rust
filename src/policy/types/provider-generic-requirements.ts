import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustProviderTypeParameterRequirement,
} from "../../target-model/operations/model.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsTrait,
  rustCarrierSupportsClone,
} from "./target-types.js";

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
