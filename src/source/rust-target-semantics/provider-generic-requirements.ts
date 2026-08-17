import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProviderTypeParameterRequirement,
} from "../provider-packages/index.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
} from "../rust-target-types.js";

export function rustProviderGenericRequirementsAreSatisfied(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: ReadonlyMap<string, TargetTypeRef>,
): boolean {
  for (const parameter of requirements ?? []) {
    const carrier = bindings.get(parameter.name);
    if (carrier === undefined || parameter.requirements.some((requirement) =>
      requirement === "copy"
        ? !isRustCopyCarrier(carrier)
        : !rustCarrierSupportsClone(carrier))) {
      return false;
    }
  }
  return true;
}
