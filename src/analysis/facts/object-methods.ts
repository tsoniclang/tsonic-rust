import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { RustFinalizedValueConversion } from "./finalized-operation-abi.js";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "./callable-adapters.js";

export interface RustObjectLiteralMethodAdapterFact {
  readonly implementations: readonly {
    readonly sourceCallable: Node;
    readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
    readonly parameters: readonly RustCallableParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
  }[];
  readonly dispatches: readonly {
    readonly contractMethod: Node;
    readonly virtualSlot: string;
    readonly implementationIndex: number;
    readonly parameters: readonly RustCallableParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
    readonly resultAdapter: RustCallableValueAdapter;
    readonly adapterFallible: boolean;
  }[];
}

export const rustObjectLiteralMethodAdapterFactKey: RustPlanKey<RustObjectLiteralMethodAdapterFact> =
  defineRustPlanKey("objectLiteralMethodAdapter", objectLiteralMethodAdapterFactEquals);

function objectLiteralMethodAdapterFactEquals(
  left: RustObjectLiteralMethodAdapterFact,
  right: RustObjectLiteralMethodAdapterFact,
): boolean {
  return left.implementations.length === right.implementations.length &&
    left.implementations.every((implementation, index) => {
      const candidate = right.implementations[index];
      return candidate !== undefined && implementation.sourceCallable === candidate.sourceCallable &&
        closedMetadataEquals(
          {
            typeParameterSubstitutions: implementation.typeParameterSubstitutions,
            parameters: implementation.parameters,
            returnCarrier: implementation.returnCarrier,
          },
          {
            typeParameterSubstitutions: candidate.typeParameterSubstitutions,
            parameters: candidate.parameters,
            returnCarrier: candidate.returnCarrier,
          },
        );
    }) &&
    left.dispatches.length === right.dispatches.length &&
    left.dispatches.every((dispatch, index) => {
      const candidate = right.dispatches[index];
      return candidate !== undefined && dispatch.contractMethod === candidate.contractMethod &&
        closedMetadataEquals(
          {
            virtualSlot: dispatch.virtualSlot,
            implementationIndex: dispatch.implementationIndex,
            parameters: dispatch.parameters,
            returnCarrier: dispatch.returnCarrier,
            parameterAdapters: dispatch.parameterAdapters,
            resultAdapter: dispatch.resultAdapter,
            adapterFallible: dispatch.adapterFallible,
          },
          {
            virtualSlot: candidate.virtualSlot,
            implementationIndex: candidate.implementationIndex,
            parameters: candidate.parameters,
            returnCarrier: candidate.returnCarrier,
            parameterAdapters: candidate.parameterAdapters,
            resultAdapter: candidate.resultAdapter,
            adapterFallible: candidate.adapterFallible,
          },
        );
    });
}

// Declarations whose lowering returns TsonicResult<T>: they throw, or they
// transitively call fallible operations outside a try boundary.
export const rustFallibleFactKey: RustPlanKey<{ readonly fallible: true }> =
  defineRustPlanKey("fallible", () => true);

export interface RustSourceCallEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
  readonly unionBranches?: readonly ("infallible" | "fallible")[];
}

// Total post-fixpoint effects for an exact selected project-source call.
export const rustSourceCallEffectsFactKey: RustPlanKey<RustSourceCallEffectsFact> =
  defineRustPlanKey("sourceCallEffects", closedMetadataEquals);

export interface RustSourceAccessorEffectsFact {
  readonly read?: "infallible" | "fallible";
  readonly write?: "infallible" | "fallible";
}

export const rustSourceAccessorEffectsFactKey: RustPlanKey<RustSourceAccessorEffectsFact> =
  defineRustPlanKey("sourceAccessorEffects", closedMetadataEquals);

export interface RustFutureValueFact {
  readonly outputCarrier: TargetTypeRef;
  readonly awaitedConversion: RustFinalizedValueConversion;
  readonly awaiting: "infallible" | "fallible";
  readonly errorBoundary: RustErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
}

// Exact await behavior for one first-class future value. Unlike its runtime
// carrier, this fact preserves operation-specific rejection and result-
// conversion semantics while the value flows through immutable bindings.
export const rustFutureValueFactKey: RustPlanKey<RustFutureValueFact> =
  defineRustPlanKey("futureValue", closedMetadataEquals);
