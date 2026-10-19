import type { TargetTypeRef } from "../types/model.js";
import type { RustSourceGenericParameterContract, RustSourceGenericContract, RustLifetimeRef } from "../lifetimes/model.js";
import type { RustDeclarationGenericRequirementContract } from "./generic-requirements.js";

export interface RustNativeCallableGenericInput {
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
  readonly traits: readonly TargetTypeRef[];
  readonly retained: { readonly error: TargetTypeRef; readonly targets: readonly TargetTypeRef[] } | undefined;
}

export interface RustNativeCallableGenericContext {
  readonly sourceContract: RustSourceGenericContract;
  readonly implicitLifetimes: readonly RustSourceGenericParameterContract[];
  readonly inputs: readonly RustNativeCallableGenericInput[];
  readonly sourceRequirements: RustDeclarationGenericRequirementContract | undefined;
  readonly bodyRequirements: RustDeclarationGenericRequirementContract | undefined;
  readonly retention: {
    readonly lifetime: RustLifetimeRef;
    readonly source: readonly TargetTypeRef[];
    readonly body: readonly TargetTypeRef[];
  } | undefined;
}
