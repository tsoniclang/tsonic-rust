import type { TargetTypeRef } from "../../types/model.js";
import type { RustSourceGenericParameterContract, RustSourceGenericContract, RustLifetimeRef } from "../../lifetimes/model.js";
import type { RustDeclarationGenericRequirementContract } from "../types/generic-requirements.js";
import type { RustGenericRequirement } from "../types/generic-requirements.js";
import type { Node } from "@tsonic/tsts";
import type { RustNativeFutureEnvironmentSelection, RustNativeFutureInput } from "./native-future-inputs.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export interface RustGenericRequirementEmissionRecords {
  readonly declarationRequirements: { readonly get: (declaration: Node, body?: true) => RustDeclarationGenericRequirementContract | undefined };
  readonly carrierClone: { readonly get: (carrier: TargetTypeRef, declaration: Node, body?: true) => boolean | undefined };
  readonly genericRequirementUse: { readonly get: (declaration: Node, node: Node, carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[], body?: true) => true | undefined };
}

export interface RustNativeCallableGenericInput {
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
  readonly traits: readonly TargetTypeRef[];
  readonly retained: { readonly error: TargetTypeRef; readonly targets: readonly TargetTypeRef[] } | undefined;
  /** The invocation error converted into the program error where the input is invoked in a catching try body. */
  readonly caught: { readonly error: TargetTypeRef; readonly target: TargetTypeRef } | undefined;
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

export type RustNativeCallableGenericHeader = Pick<RustNativeCallableGenericContext,
  "sourceContract" | "implicitLifetimes" | "retention"> & {
  readonly futureEnvironment: Extract<RustNativeFutureEnvironmentSelection, { readonly kind: "resolved" }>;
  readonly callableInputs: readonly RustNativeCallableInput[];
  readonly inputs: readonly RustNativeFutureInput[];
};
