import type { TargetTypeRef } from "../types/model.js";
import type { RustSourceGenericParameterContract } from "../lifetimes/model.js";
import type { RustDeclarationTypeParameterRequirements } from "../../target-model/records/generic-requirements.js";

export interface RustNativeCallableGenericInput {
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
  readonly traits: readonly TargetTypeRef[];
  readonly retained: { readonly error: TargetTypeRef; readonly targets: readonly TargetTypeRef[] } | undefined;
}

export interface RustNativeCallableGenericContext {
  readonly implicitLifetimes: readonly RustSourceGenericParameterContract[];
  readonly inputs: readonly RustNativeCallableGenericInput[];
  readonly sourceRequirements: readonly RustDeclarationTypeParameterRequirements[] | undefined;
  readonly bodyRequirements: readonly RustDeclarationTypeParameterRequirements[] | undefined;
}
