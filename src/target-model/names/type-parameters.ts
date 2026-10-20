import type { TargetTypeRef } from "../types/model.js";
import type { RustTypeLifetimeContract } from "../lifetimes/model.js";
export {
  generatedTypeParameterNames as rustGeneratedTypeParameterNames,
  authoredTypeParameterNames as rustAuthoredTypeParameterNames,
} from "@tsonic/target-api/source";

export function rustTypeParameterFromSourceContract(
  parameter: RustTypeLifetimeContract,
): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> {
  return Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: parameter.targetName });
}
